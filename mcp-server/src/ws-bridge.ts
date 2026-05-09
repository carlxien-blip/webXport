import { WebSocketServer, WebSocket } from 'ws';

const PORT_RANGE_START = 7654;
const PORT_RANGE_END = 7659;
const HOST = '127.0.0.1';

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (e: Error) => void;
  timeout: NodeJS.Timeout;
}

interface RpcReply {
  type: 'rpc-reply';
  id: number;
  result?: unknown;
  error?: string;
}

class WSBridge {
  private wss: WebSocketServer | null = null;
  private port: number = -1;
  private extensionWs: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();

  async init(): Promise<void> {
    const envPort = process.env.WEBXPORT_MCP_PORT;
    if (envPort) {
      const port = Number(envPort);
      this.wss = await this.bindPort(port);
      this.port = port;
    } else {
      for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
        try {
          this.wss = await this.bindPort(port);
          this.port = port;
          break;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
        }
      }
    }
    if (!this.wss) {
      throw new Error(
        `[webxport-mcp] no free port available in ${PORT_RANGE_START}-${PORT_RANGE_END}; if you have many Claude Code sessions, restart some.`
      );
    }
    process.stderr.write(`[webxport-mcp] WS bridge listening on ${HOST}:${this.port}\n`);
    this.wss.on('connection', (ws) => this.onConnection(ws));
    this.wss.on('error', (e) => console.error('[webxport-mcp] WSS error:', e));
  }

  private bindPort(port: number): Promise<WebSocketServer> {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({ host: HOST, port });
      const onListening = () => {
        server.off('error', onError);
        resolve(server);
      };
      const onError = (e: Error) => {
        server.off('listening', onListening);
        reject(e);
      };
      server.once('listening', onListening);
      server.once('error', onError);
    });
  }

  private onConnection(ws: WebSocket): void {
    process.stderr.write(`[webxport-mcp] extension connected on port ${this.port}\n`);
    if (this.extensionWs && this.extensionWs.readyState === WebSocket.OPEN) {
      this.extensionWs.close(1000, 'replaced by new extension instance');
    }
    this.extensionWs = ws;

    ws.send(
      JSON.stringify({ type: 'webxport-server-hello', port: this.port, version: '0.1.0' })
    );

    ws.on('message', (data) => this.onMessage(data.toString()));
    ws.on('close', () => {
      if (this.extensionWs === ws) this.extensionWs = null;
      process.stderr.write(`[webxport-mcp] extension disconnected from port ${this.port}\n`);
      for (const [id, p] of this.pending) {
        clearTimeout(p.timeout);
        p.reject(new Error('extension disconnected mid-call'));
        this.pending.delete(id);
      }
    });
    ws.on('error', (e) => process.stderr.write(`[webxport-mcp] ws error: ${e.message}\n`));
  }

  private onMessage(text: string): void {
    let msg: RpcReply;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type !== 'rpc-reply') return;
    const call = this.pending.get(msg.id);
    if (!call) return;
    this.pending.delete(msg.id);
    clearTimeout(call.timeout);
    if (msg.error !== undefined) call.reject(new Error(msg.error));
    else call.resolve(msg.result);
  }

  async call(method: string, params: unknown, timeoutMs = 60_000): Promise<unknown> {
    if (!this.extensionWs || this.extensionWs.readyState !== WebSocket.OPEN) {
      throw new Error(
        '扩展未连接到 MCP server。请打开 Chrome 中 webXport 插件的 popup 一次以唤醒它（W 图标），然后重试。'
      );
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method} (${timeoutMs}ms)`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.extensionWs!.send(JSON.stringify({ type: 'rpc', id, method, params }));
    });
  }

  isConnected(): boolean {
    return this.extensionWs !== null && this.extensionWs.readyState === WebSocket.OPEN;
  }

  getPort(): number {
    return this.port;
  }
}

export const bridge = new WSBridge();
