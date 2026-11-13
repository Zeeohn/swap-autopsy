// A small JSON-RPC client. It can record every response to a fixture file,
// and a replay client answers from that file, so tests run offline on real mainnet data.

export type Rpc = (method: string, params: unknown[]) => Promise<any>;

const key = (method: string, params: unknown[]) => `${method} ${JSON.stringify(params)}`;

export class RpcError extends Error {
  method: string;
  detail: unknown;
  constructor(method: string, detail: unknown) {
    super(`${method} failed: ${JSON.stringify(detail)}`);
    this.method = method;
    this.detail = detail;
  }
}

export function httpRpc(url: string, recording?: Record<string, unknown>): Rpc {
  let id = 0;
  return async (method, params) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
          signal: AbortSignal.timeout(30_000),
        });
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (body.error) {
          // Record errors too, so a replay fails the same way the live call did.
          if (recording) recording[key(method, params)] = { rpcError: body.error };
          throw new RpcError(method, body.error);
        }
        if (recording) recording[key(method, params)] = body.result;
        return body.result;
      } catch (err) {
        // An RPC error is an answer (for example, a call that reverts). Only retry network trouble.
        if (err instanceof RpcError || attempt === 4) throw err;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  };
}

export function replayRpc(fixture: Record<string, unknown>): Rpc {
  return async (method, params) => {
    const k = key(method, params);
    if (!(k in fixture)) throw new Error(`no recorded response for ${k}`);
    const value = fixture[k] as any;
    if (value && typeof value === 'object' && 'rpcError' in value) throw new RpcError(method, value.rpcError);
    return value;
  };
}
