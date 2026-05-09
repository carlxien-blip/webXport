import { listScripts } from './storage';
import { runScript, getRunState } from './runner';
import type { Script, RunResult } from '../shared/types';

const MCP_URL = 'ws://127.0.0.1:7654';
const RECONNECT_DELAY_MS = 5000;

interface RpcMessage {
  type: 'rpc';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let suppressLog = false;

export function ensureMcpConnected(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  connect();
}

function connect(): void {
  try {
    ws = new WebSocket(MCP_URL);
    ws.addEventListener('open', () => {
      console.log('[webxport mcp] connected to', MCP_URL);
      suppressLog = false;
    });
    ws.addEventListener('close', () => {
      if (!suppressLog) console.log('[webxport mcp] disconnected, will retry');
      ws = null;
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      if (!suppressLog) console.log('[webxport mcp] connection failed (MCP server probably not running)');
      suppressLog = true;
    });
    ws.addEventListener('message', (e) => {
      void onMessage(typeof e.data === 'string' ? e.data : '');
    });
  } catch (e) {
    if (!suppressLog) console.log('[webxport mcp] connect threw:', (e as Error).message);
    suppressLog = true;
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

async function onMessage(text: string): Promise<void> {
  let msg: RpcMessage;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  if (msg.type !== 'rpc') return;

  let result: unknown;
  let error: string | undefined;
  try {
    result = await dispatch(msg.method, msg.params ?? {});
  } catch (e) {
    error = (e as Error).message;
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    const payload = error !== undefined
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
