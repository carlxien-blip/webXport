import { listScripts } from './storage';
import { runScript, getRunState } from './runner';
import type { Script, RunResult } from '../shared/types';

const HOST = '127.0.0.1';
const PORT_RANGE = [7654, 7655, 7656, 7657, 7658, 7659];
const PROBE_TIMEOUT_MS = 1000;
const RETRY_DELAY_MS = 5000;

interface PoolEntry {
  ws: WebSocket;
  port: number;
}

const pool: Map<number, PoolEntry> = new Map();
let scanning = false;

export async function ensureMcpConnected(): Promise<void> {
  if (scanning) return;
  scanning = true;
  try {
    await scanSequential();
    if (pool.size === 0) {
      await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS));
      await scanSequential();
    }
  } finally {
    scanning = false;
  }
}

async function scanSequential(): Promise<void> {
  for (const port of PORT_RANGE) {
    if (pool.has(port)) continue;
    const ok = await tryConnect(port);
    if (!ok) break;
  }
}

function tryConnect(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://${HOST}:${port}`);
    } catch {
      resolve(false);
      return;
    }

    let confirmed = false;
    let settled = false;

    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (!ok && ws.readyState !== WebSocket.CLOSED) ws.close();
      resolve(ok);
    };

    const probeTimeout = setTimeout(() => settle(false), PROBE_TIMEOUT_MS);

    ws.addEventListener('message', (e) => {
      const data = typeof e.data === 'string' ? e.data : '';
      if (!confirmed) {
        clearTimeout(probeTimeout);
        try {
          const msg = JSON.parse(data);
          if (msg && msg.type === 'webxport-server-hello') {
            confirmed = true;
            pool.set(port, { ws, port });
            console.log('[webxport mcp] connected on port', port);
            settle(true);
            return;
          }
        } catch {}
        settle(false);
        return;
      }
      void onRpcMessage(ws, data);
    });

    ws.addEventListener('close', () => {
      clearTimeout(probeTimeout);
      if (confirmed) {
        pool.delete(port);
        console.log('[webxport mcp] disconnected from port', port);
      } else {
        settle(false);
      }
    });

    ws.addEventListener('error', () => {
      // close will fire next; settle there
    });
  });
}

async function onRpcMessage(ws: WebSocket, data: string): Promise<void> {
  let msg: { type?: string; id?: number; method?: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(data);
  } catch {
    return;
  }
  if (msg.type !== 'rpc' || typeof msg.id !== 'number' || !msg.method) return;

  let result: unknown;
  let error: string | undefined;
  try {
    result = await dispatch(msg.method, msg.params ?? {});
  } catch (e) {
    error = (e as Error).message;
  }
  if (ws.readyState === WebSocket.OPEN) {
    const payload =
      error !== undefined
        ? { type: 'rpc-reply', id: msg.id, error }
        : { type: 'rpc-reply', id: msg.id, result };
    ws.send(JSON.stringify(payload));
  }
}

async function dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case 'list_scripts':
      return await rpcListScripts();
    case 'run_script':
      return await rpcRunScript(
        params.name as string,
        (params.waitForResult as boolean | undefined) ?? true
      );
    case 'get_runs':
      return await rpcGetRuns(params.name as string | undefined);
    case 'get_run_status':
      return rpcGetRunStatus();
    default:
      throw new Error(`未知方法: ${method}`);
  }
}

async function rpcListScripts(): Promise<Script[]> {
  return await listScripts();
}

async function rpcRunScript(
  name: string,
  waitForResult: boolean
): Promise<RunResult | { started: true }> {
  if (!name) throw new Error('参数 name 必填');
  const all = await listScripts();
  const target = all.find((s) => s.name === name);
  if (!target) throw new Error(`脚本不存在：${name}`);

  if (!waitForResult) {
    runScript(target).catch((e) => console.error('[webxport mcp] background run failed:', e));
    return { started: true };
  }

  const result = await runScript(target);
  return result;
}

async function rpcGetRuns(name: string | undefined): Promise<unknown> {
  if (name) {
    const s = (await listScripts()).find((s) => s.name === name);
    if (!s) throw new Error(`脚本不存在：${name}`);
    return { runs: s.runs };
  }
  const all = await listScripts();
  return all.map((s) => ({ name: s.name, runs: s.runs }));
}

function rpcGetRunStatus(): unknown {
  return getRunState();
}
