// Record every RPC response for one swap into test/fixtures/<hash>.json, for offline tests.
// Usage: npm run record -- <txHash> [--rpc URL]
import { writeFileSync } from 'node:fs';
import { autopsy } from '../src/autopsy.ts';
import { httpRpc } from '../src/rpc.ts';

const [hash] = process.argv.slice(2).filter((a) => a.startsWith('0x'));
const i = process.argv.indexOf('--rpc');
const url = i === -1 ? (process.env.RPC_URL ?? 'https://eth.drpc.org') : process.argv[i + 1];
const recording: Record<string, unknown> = {};
const report = await autopsy(httpRpc(url, recording), hash);
writeFileSync(`test/fixtures/${hash}.json`, JSON.stringify(recording));
console.log(`recorded ${Object.keys(recording).length} responses · ${report.status} · ${report.failure?.error ?? 'ok'}`);
