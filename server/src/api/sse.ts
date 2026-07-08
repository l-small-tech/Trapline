/**
 * Server-Sent Events hub. The dashboard subscribes to /trapline/api/live;
 * we push status, batched samples, events, speed-test progress, and
 * Full-Capture suggestions. SSE (vs WebSocket) because traffic is strictly
 * server→client and EventSource reconnects natively.
 */
import type { ServerResponse } from 'node:http';
import type { SseMessage } from '../../../shared/types.js';

const KEEPALIVE_MS = 15_000;

export class SseHub {
  private clients = new Set<ServerResponse>();
  private keepalive: NodeJS.Timeout;
  private nextId = 1;

  constructor() {
    this.keepalive = setInterval(() => {
      for (const res of this.clients) res.write(': keepalive\n\n');
    }, KEEPALIVE_MS);
    this.keepalive.unref();
  }

  clientCount(): number {
    return this.clients.size;
  }

  addClient(res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  broadcast(msg: SseMessage): void {
    if (this.clients.size === 0) return;
    const payload = `id: ${this.nextId++}\nevent: ${msg.type}\ndata: ${JSON.stringify(msg.data)}\n\n`;
    for (const res of this.clients) {
      res.write(payload);
    }
  }

  close(): void {
    clearInterval(this.keepalive);
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
