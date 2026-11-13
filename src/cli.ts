#!/usr/bin/env node
// Usage: swap-autopsy <txHash> [more hashes...] [--rpc URL] [--json]
// The RPC must support debug_traceTransaction (callTracer). Default: RPC_URL, else a public Ethereum endpoint.
import { autopsy, fmt, type Report } from './autopsy.ts';
import { labels } from './known.ts';
import { httpRpc } from './rpc.ts';

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv.splice(i, 2)[1];
};
const json = argv.includes('--json') ? (argv.splice(argv.indexOf('--json'), 1), true) : false;
const url = flag('--rpc') ?? process.env.RPC_URL ?? 'https://eth.drpc.org';
const hashes = argv.filter((a) => /^0x[0-9a-fA-F]{64}$/.test(a));
if (hashes.length === 0) {
  console.error('usage: swap-autopsy <txHash> [more hashes...] [--rpc URL] [--json]');
  process.exit(2);
}

const rpc = httpRpc(url);
const reports: Report[] = [];
for (const hash of hashes) {
  try {
    const r = await autopsy(rpc, hash);
    reports.push(r);
    if (!json) console.log(text(r) + '\n');
  } catch (err) {
    console.error(`${hash}: ${(err as Error).message}\n`);
  }
}

if (json) {
  console.log(JSON.stringify(reports, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
} else if (reports.length > 1) {
  const counts = new Map<string, number>();
  for (const r of reports) {
    const k = r.failure?.error ?? 'success';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  console.log(`Summary of ${reports.length} swaps:`);
  for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
}

function text(r: Report): string {
  const lines = [
    `${r.hash}  block ${r.block}`,
    `${r.status === 'success' ? '✅ SUCCESS' : '❌ REVERTED'} · entry ${r.entry} · ${r.actions} action(s) · gas ${r.gas.used}/${r.gas.limit}`,
    `Settler ${r.settler} ${r.genuineSettler === true ? '(genuine)' : r.genuineSettler === false ? '⚠️ NOT a registered Settler' : '(registry not readable)'}`,
  ];
  if (r.sell) lines.push(`Sell  ${fmt(r.sell.amount, r.sell.token)}`);
  lines.push(`Buy   at least ${fmt(r.buy.minAmountOut, r.buy.token)} → ${r.buy.recipient}`);
  if (r.failure) {
    lines.push(`Why   ${r.failure.error}: ${r.failure.detail}`);
    lines.push(`From  ${r.failure.origin}${labels[r.failure.origin] ? ` ${labels[r.failure.origin]}` : ''} (depth ${r.failure.depth} in the call tree)`);
    if (r.failure.hint) lines.push(`Fix   ${r.failure.hint}`);
  }
  if (r.outcome) {
    const h = r.outcome.headroomPct;
    lines.push(`Got   ${fmt(r.outcome.received, r.buy.token)}${h === null ? '' : ` (${h}% above the minimum)`}`);
  }
  return lines.join('\n');
}
