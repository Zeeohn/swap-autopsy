// autopsy() takes one transaction hash and explains the 0x Settler swap inside it:
// what the sender asked for, whether the target was a genuine Settler, and then either
// why it reverted (and which contract started the revert) or how much it actually received.
import {
  decodeAbiParameters, decodeErrorResult, decodeEventLog, decodeFunctionData, decodeFunctionResult,
  encodeFunctionData, formatUnits, parseAbiParameters, toFunctionSelector,
} from 'viem';
import {
  ALLOWANCE_HOLDER, FEATURE_TAKER_SUBMITTED, NATIVE, ZERO_EX_DEPLOYER,
  allowanceHolderAbi, deployerAbi, erc20Abi, errorAbi, hints, settlerAbi,
} from './known.ts';
import type { Rpc } from './rpc.ts';

// One frame of a callTracer trace (debug_traceTransaction with { tracer: 'callTracer' }).
export interface Call {
  from: string; to: string; input: string; value?: string;
  gas: string; gasUsed: string; output?: string; error?: string; calls?: Call[];
}

export interface Token { address: string; symbol: string; decimals: number }

export interface Report {
  hash: string;
  block: number;
  status: 'success' | 'reverted';
  entry: 'AllowanceHolder' | 'Settler (Permit2)';
  settler: string;
  genuineSettler: boolean | null; // null = the registry could not be read at that block
  sell?: { token: Token; amount: bigint }; // known only on the AllowanceHolder path
  buy: { token: Token; minAmountOut: bigint; recipient: string };
  actions: number;
  gas: { limit: number; used: number };
  failure?: { error: string; detail: string; hint: string; origin: string; depth: number; raw: string };
  outcome?: { received: bigint; headroomPct: number | null };
}

const lower = (a: string) => a.toLowerCase();

export async function autopsy(rpc: Rpc, hash: string): Promise<Report> {
  const tx = await rpc('eth_getTransactionByHash', [hash]);
  if (!tx) throw new Error(`transaction ${hash} not found on this chain`);
  const receipt = await rpc('eth_getTransactionReceipt', [hash]);
  if (!receipt) throw new Error(`transaction ${hash} is not mined yet`);
  const block = tx.blockNumber as string;

  // 1. Entry point. AllowanceHolder.exec() wraps the Settler call after a normal ERC-20 approval.
  //    Otherwise the sender called Settler directly and pays through a Permit2 signature.
  let entry: Report['entry'];
  let settler: string;
  let settlerInput: `0x${string}`;
  let sell: Report['sell'];
  if (tx.to && lower(tx.to) === ALLOWANCE_HOLDER) {
    const { args } = decodeFunctionData({ abi: allowanceHolderAbi, data: tx.input });
    const [, token, amount, target, data] = args;
    entry = 'AllowanceHolder';
    settler = lower(target);
    settlerInput = data;
    sell = { token: await tokenInfo(rpc, token, block), amount };
  } else {
    entry = 'Settler (Permit2)';
    settler = lower(tx.to ?? '');
    settlerInput = tx.input;
  }

  // 2. What the sender asked for. Settler's first argument is the slippage limit.
  const { recipient, buyToken, minAmountOut, actions } = readSettlerCall(hash, settlerInput);

  const report: Report = {
    hash,
    block: Number(block),
    status: receipt.status === '0x1' ? 'success' : 'reverted',
    entry,
    settler,
    // 3. The 0x README says to always check the deployer/registry for the genuine Settler.
    genuineSettler: await isGenuineSettler(rpc, settler, block),
    sell,
    buy: {
      token: await tokenInfo(rpc, buyToken, block),
      minAmountOut,
      recipient: lower(recipient),
    },
    actions,
    gas: { limit: Number(tx.gas), used: Number(receipt.gasUsed) },
  };

  const trace: Call = await rpc('debug_traceTransaction', [hash, { tracer: 'callTracer' }]);
  if (report.status === 'reverted') report.failure = await diagnose(rpc, trace, report);
  else report.outcome = measure(trace, receipt, report);
  return report;
}

const settlerSelectors = new Set(
  settlerAbi.filter((x) => x.type === 'function').map((f) => toFunctionSelector(f)),
);

// Read execute(slippage, actions, zid) and executeWithPermit(...): the slippage struct sits in the
// first three words, and word 4 points to the actions array. Settler parses its actions with its
// own calldata reader, and real swaps sometimes use offsets that viem's strict decoder rejects
// (out-of-order or shared array elements). So read only the fixed-position words we need.
function readSettlerCall(hash: string, input: `0x${string}`) {
  if (!settlerSelectors.has(input.slice(0, 10) as `0x${string}`)) {
    throw new Error(`${hash} is not a taker-submitted 0x Settler swap (execute/executeWithPermit)`);
  }
  const body = `0x${input.slice(10)}` as `0x${string}`;
  const [recipient, buyToken, minAmountOut, actionsOffset] = decodeAbiParameters(
    parseAbiParameters('address, address, uint256, uint256'),
    body.slice(0, 2 + 64 * 4) as `0x${string}`,
  );
  const at = 2 + Number(actionsOffset) * 2;
  const actions = Number(BigInt(`0x${body.slice(at, at + 64)}`));
  return { recipient, buyToken, minAmountOut, actions };
}

// Find where the revert started, and decode it.
async function diagnose(rpc: Rpc, trace: Call, report: Report): Promise<NonNullable<Report['failure']>> {
  // A contract that does not catch a failed call returns the same revert data it received.
  // So follow the failed child whose output equals ours: that walks down to the source.
  let origin = trace;
  let depth = 0;
  for (;;) {
    const child = origin.calls?.find((c) => c.error && (c.output ?? '0x') === (origin.output ?? '0x'));
    if (!child) break;
    origin = child;
    depth++;
  }

  const raw = trace.output ?? '0x';
  const where = { origin: lower(origin.to), depth, raw };
  if (/out of gas/i.test(origin.error ?? '') || /out of gas/i.test(trace.error ?? '')) {
    return { ...where, error: 'OutOfGas', detail: `gas limit ${report.gas.limit}, used ${report.gas.used}`, hint: 'The transaction ran out of gas. Fix: use the gas estimate from the quote, plus a margin.' };
  }
  if (raw === '0x') {
    return { ...where, error: 'EmptyRevert', detail: 'the contract reverted without a reason', hint: 'No reason given. Look at the origin contract: often a token that blocks the transfer.' };
  }

  let name: string;
  let args: readonly unknown[] = [];
  try {
    const e = decodeErrorResult({ abi: errorAbi, data: raw as `0x${string}` });
    name = e.errorName;
    args = e.args ?? [];
  } catch {
    return { ...where, error: `Unknown(${raw.slice(0, 10)})`, detail: 'selector not in the known list', hint: 'Look up the selector, then add it to src/known.ts.' };
  }
  return { ...where, error: name, detail: await describe(rpc, name, args, report), hint: hints[name] ?? '' };
}

// Turn error arguments into a sentence, with token amounts in normal units.
async function describe(rpc: Rpc, name: string, args: readonly unknown[], report: Report): Promise<string> {
  const block = `0x${report.block.toString(16)}`;
  if (name === 'TooMuchSlippage') {
    const [token, expected, actual] = args as [string, bigint, bigint];
    const t = await tokenInfo(rpc, token, block);
    const short = expected > 0n ? Number(((expected - actual) * 10_000n) / expected) / 100 : 0;
    return `would receive ${fmt(actual, t)}, minimum was ${fmt(expected, t)} (${short}% short)`;
  }
  if (name === 'ReturnAmountIsNotEnough') {
    const [result, min] = args as [bigint, bigint];
    const short = min > 0n ? Number(((min - result) * 1_000_000n) / min) / 10_000 : 0;
    return `source returned ${result}, its minimum was ${min} (${short}% short, raw units)`;
  }
  if (name === 'Error') return `reason: "${String(args[0])}"`;
  if (name === 'Panic') return `panic code ${String(args[0])}`;
  return args.length ? args.map(String).join(', ') : 'no arguments';
}

// For a successful swap: how much of the buy token reached the recipient, and how far above
// the minimum that was. Headroom near 0% means the swap nearly reverted on slippage.
function measure(trace: Call, receipt: any, report: Report): NonNullable<Report['outcome']> {
  const { token, recipient, minAmountOut } = report.buy;
  let received = 0n;
  if (lower(token.address) === NATIVE) {
    // Native ETH does not emit Transfer logs, so add up the value sent to the recipient in the trace.
    const walk = (c: Call) => {
      if (lower(c.to ?? '') === recipient && c.value && !c.error) received += BigInt(c.value);
      c.calls?.forEach(walk);
    };
    trace.calls?.forEach(walk);
  } else {
    for (const log of receipt.logs) {
      if (lower(log.address) !== lower(token.address)) continue;
      try {
        const ev = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
        if (ev.eventName === 'Transfer' && lower(ev.args.to) === recipient) received += ev.args.value;
      } catch { /* not a standard Transfer log */ }
    }
  }
  const headroomPct = minAmountOut > 0n ? Number(((received - minAmountOut) * 10_000n) / minAmountOut) / 100 : null;
  return { received, headroomPct };
}

async function isGenuineSettler(rpc: Rpc, settler: string, block: string): Promise<boolean | null> {
  try {
    const current = await call(rpc, ZERO_EX_DEPLOYER, deployerAbi, 'ownerOf', [FEATURE_TAKER_SUBMITTED], block);
    const previous = await call(rpc, ZERO_EX_DEPLOYER, deployerAbi, 'prev', [FEATURE_TAKER_SUBMITTED], block);
    return lower(current as string) === settler || lower(previous as string) === settler;
  } catch {
    return null;
  }
}

async function tokenInfo(rpc: Rpc, address: string, block: string): Promise<Token> {
  if (lower(address) === NATIVE) return { address: NATIVE, symbol: 'ETH', decimals: 18 };
  const symbol = await call(rpc, address, erc20Abi, 'symbol', [], block).catch(() => '?');
  const decimals = await call(rpc, address, erc20Abi, 'decimals', [], block).catch(() => 0);
  return { address: lower(address), symbol: String(symbol), decimals: Number(decimals) };
}

async function call(rpc: Rpc, to: string, abi: any, functionName: string, args: unknown[], block: string) {
  const data = encodeFunctionData({ abi, functionName, args });
  const result = await rpc('eth_call', [{ to, data }, block]);
  return decodeFunctionResult({ abi, functionName, data: result });
}

export const fmt = (amount: bigint, t: Token) => `${formatUnits(amount, t.decimals)} ${t.symbol}`;
