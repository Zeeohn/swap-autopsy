// Offline tests on real Ethereum mainnet swaps (blocks 26405153–26405625, 13 Nov 2026).
// Each fixture holds the RPC responses recorded by scripts/record.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { autopsy } from '../src/autopsy.ts';
import { replayRpc } from '../src/rpc.ts';

const run = (hash: string) =>
  autopsy(replayRpc(JSON.parse(readFileSync(`test/fixtures/${hash}.json`, 'utf8'))), hash);

const SETTLER = '0xaddc26a3854feabfd20d6bf658254088d83a425a';

test('slippage: Settler itself reverts with TooMuchSlippage, with amounts in ETH', async () => {
  const r = await run('0x9d2917d059a7e856e9f7a4073e5371dd02b940b81c42e0718bbc1fb209ff1ef3');
  assert.equal(r.status, 'reverted');
  assert.equal(r.entry, 'AllowanceHolder');
  assert.equal(r.genuineSettler, true);
  assert.equal(r.failure?.error, 'TooMuchSlippage');
  assert.equal(r.failure?.origin, SETTLER);
  assert.equal(r.failure?.depth, 1);
  assert.equal(r.failure?.detail, 'would receive 1.281831404798443636 ETH, minimum was 1.282436055473023852 ETH (0.04% short)');
  assert.equal(r.sell?.token.symbol, 'USDC');
  assert.equal(r.sell?.amount, 2_500_000_000n);
});

test('RFQ: a market maker quote expired five calls deep', async () => {
  const r = await run('0xc1e7a6a04d2b5937dd8adb8f79ade8201fc78c9070226ea8952ef1473aebf983');
  assert.equal(r.failure?.error, 'QuoteExpired');
  assert.equal(r.failure?.depth, 5);
  assert.notEqual(r.failure?.origin, SETTLER);
});

test('inner source: 1inch router returned less than its own minimum', async () => {
  const r = await run('0xa405222a60b4acb1dbbb96b1472133ec733df6d167123c826f275def521f9bcf');
  assert.equal(r.failure?.error, 'ReturnAmountIsNotEnough');
  assert.equal(r.failure?.origin, '0x111111125421ca6dc452d289314280a0f8842a65');
  assert.match(r.failure?.detail ?? '', /0\.0029% short/);
});

test('Permit2 flow: a smart-wallet signature was rejected', async () => {
  const r = await run('0x2919a0c9b032dcf17a0f00d9ba05289b4f5fb9ee8097ddf25777c5b071cffc34');
  assert.equal(r.entry, 'Settler (Permit2)');
  assert.equal(r.sell, undefined);
  assert.equal(r.failure?.error, 'InvalidContractSignature');
  assert.equal(r.failure?.origin, '0x000000000022d473030f116ddee9f6b43ac78ba3');
});

test('plain revert string is decoded as Error(string)', async () => {
  const r = await run('0x624d43af7a54dfdc40b1b3f8acf69c915d61ad329e996bc862551e8bb21f2b4e');
  assert.equal(r.failure?.error, 'Error');
  assert.equal(r.failure?.detail, 'reason: "IG"');
});

test('success, ERC-20 out: amount from Transfer logs and headroom above the minimum', async () => {
  const r = await run('0xc08535579a9aca00542da79abc96e6dbb1fd4d4aeb3fd8121c878906a3213b62');
  assert.equal(r.status, 'success');
  assert.equal(r.outcome?.received, 1880697254684459674322n);
  assert.equal(r.outcome?.headroomPct, 0.1);
});

test('success, native ETH out: amount from value transfers in the trace', async () => {
  const r = await run('0x7a79515fcfc66410732daf07d2e0e1dce057c272222e8a2538162e77b4f08eed');
  assert.equal(r.entry, 'Settler (Permit2)');
  assert.equal(r.buy.token.symbol, 'ETH');
  assert.equal(r.outcome?.received, 15806794500945350n);
  assert.equal(r.outcome?.headroomPct, 0.44);
});

test('a transaction that is not a Settler swap is refused clearly', async () => {
  const fake = { 'eth_getTransactionByHash ["0x01"]': { to: '0x1111111111111111111111111111111111111111', input: '0xa9059cbb', blockNumber: '0x1', gas: '0x1' }, 'eth_getTransactionReceipt ["0x01"]': { status: '0x1', gasUsed: '0x1', logs: [] } };
  await assert.rejects(autopsy(replayRpc(fake), '0x01'), /not a taker-submitted 0x Settler swap/);
});
