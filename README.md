# swap-autopsy

**Why did this 0x swap fail? Give it the transaction hash and it tells you, from public on-chain data.**

Block explorers often show a failed 0x swap as just "Reverted", with no reason. The reason is in the call trace, often several calls below Settler: a market maker's expired quote, a 1inch or Uniswap v4 source, or Permit2. swap-autopsy walks the trace to the contract that started the revert, decodes the error, and says what to do about it. For a successful swap, it measures how much the recipient got and how close the swap came to its slippage limit.

```
$ npm run autopsy -- 0xc1e7a6a04d2b5937dd8adb8f79ade8201fc78c9070226ea8952ef1473aebf983

0xc1e7a6a04d2b5937dd8adb8f79ade8201fc78c9070226ea8952ef1473aebf983  block 26405410
❌ REVERTED · entry AllowanceHolder · 2 action(s) · gas 223859/856619
Settler 0xaddc26a3854feabfd20d6bf658254088d83a425a (genuine)
Sell  2744 sUSDe
Buy   at least 3449.256425 USDC → 0xd670a99b9ad6b9fe256294f51cfe5f38e51d54aa
Why   QuoteExpired: no arguments
From  0x4777a6b3a9a889abfd4c7666bdd2a7ab633293be (depth 5 in the call tree)
Fix   A market maker's RFQ quote expired before the transaction landed. Fix: fetch a fresh quote and submit sooner.
```

## What it checks
1. **Entry point.** `AllowanceHolder.exec(...)` (approve, then swap) or a direct call to Settler (Permit2). On the AllowanceHolder path, it also reads the sell token and amount.
2. **What the sender asked for.** The `AllowedSlippage` struct: recipient, buy token and `minAmountOut`.
3. **Genuine Settler.** It asks the 0x deployer/registry (`ownerOf(2)` and `prev(2)`) at the transaction's block, as the 0x-settler README says integrators must.
4. **Failed swap:**
   - It follows the failed call whose return data matches its parent's. That walks down to the contract that started the revert.
   - It decodes Settler, Permit2, ERC-20 and common liquidity-source errors, `Error(string)` and `Panic`.
   - It spots out-of-gas.
5. **Successful swap:** it sums the buy token received from `Transfer` logs (or native ETH from the trace). Then it reports the headroom above `minAmountOut`.

## Results: failed 0x swaps on Ethereum, 10–13 Nov 2026
Data: 2,500 recent transactions sent to AllowanceHolder or to MainnetSettler (1,250 each), listed by eth.blockscout.com on 13 Nov 2026. 145 of them failed. swap-autopsy analysed 144; one was not a taker-submitted Settler call. It named the error for **135 of 144 (94%)**. Every target was a genuine Settler. Raw results: `results/ethereum-2026-11-10-to-13.json`.

| Error | Swaps | Share |
|---|---|---|
| TooMuchSlippage | 53 | 37% |
| SignatureExpired | 24 | 17% |
| Error | 23 | 16% |
| OutOfGas | 9 | 6% |
| Unknown selector | 9 | 6% |
| ReturnAmountIsNotEnough | 8 | 6% |
| OrderExpired | 8 | 6% |
| InvalidContractSignature | 6 | 4% |
| ERC20InsufficientAllowance | 2 | 1% |
| QuoteExpired | 1 | 1% |
| InvalidNonce | 1 | 1% |

`Error` means a plain revert string from a source contract. The most common: "MISSING_ATTESTATION_FOR_CURRENT_BLOCK" (6), "TRANSFER_FROM_FAILED" (6), "Insufficient output" (4), "SP" (3).

**Where the revert started:**

| Contract | Swaps |
|---|---|
| MainnetSettler | 60 |
| another contract (pool, hook, token or market maker) | 37 |
| Permit2 | 31 |
| 1inch AggregationRouterV6 | 10 |
| BebopSettlement | 6 |

Two findings:
- **More than half of the failures did not start in Settler.** They came from Permit2, the 1inch router, Bebop, or pools, hooks, tokens and market makers further down. The top-level revert data alone does not say which, but the call trace does.
- **Slippage failures are usually narrow.** The median `TooMuchSlippage` swap missed its minimum by about 0.1%. A few missed by 9–11%, which looks like thin liquidity or a fast-moving token.

## Use it
Node 24+. The RPC endpoint must support `debug_traceTransaction` with `callTracer`. The default is a public Ethereum endpoint; set `RPC_URL` or pass `--rpc` to use your own.

```bash
npm install
npm run autopsy -- <txHash> [more hashes...]   # readable report, plus a summary for several
npm run autopsy -- <txHash> --json             # full report as JSON
npm test                                       # offline tests on recorded mainnet responses
npm run typecheck
npm run record -- <txHash>                     # record a swap's RPC responses as a test fixture
```

## Layout
```
src/known.ts    addresses, ABIs, error list and plain-language hints
src/autopsy.ts  decode the entry, check the registry, walk the trace, measure the outcome
src/rpc.ts      JSON-RPC client with retries, plus record/replay for tests
src/cli.ts      command line and readable report
test/           8 tests on recorded mainnet swaps
```

## Limits
- It handles taker-submitted swaps only (`execute` / `executeWithPermit`). It doesn't cover meta-transactions, intents or bridge Settlers.
- It can't name an error whose selector isn't in `src/known.ts`. It prints the selector so you can add it.
- The tests use Ethereum mainnet. Other Cancun chains use the same AllowanceHolder address, but they need an RPC with tracing.

MIT. Not affiliated with 0x.
