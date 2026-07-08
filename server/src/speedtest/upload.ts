/**
 * Upload throughput: parallel POSTs streaming a cycled 1 MB random buffer
 * (constant memory). We count bytes as the HTTP client pulls them from our
 * Readable — i.e. bytes handed to the socket — and measure over the window
 * after `rampMs`. A random buffer defeats any transparent compression.
 */
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { Agent, request } from 'undici';
import { SPEED_HEADERS, type PhaseResult } from './download.js';

const CHUNK = crypto.randomBytes(1024 * 1024);

export interface UploadOptions {
  upUrl: string;
  streams: number;
  bytesPerStream: number;
  maxDurationMs: number;
  rampMs: number;
  onProgress?: (bps: number, elapsedMs: number) => void;
}

function countingBody(totalBytes: number, onBytes: (n: number) => void): Readable {
  let sent = 0;
  return new Readable({
    read() {
      if (sent >= totalBytes) {
        this.push(null);
        return;
      }
      const n = Math.min(CHUNK.length, totalBytes - sent);
      sent += n;
      onBytes(n);
      this.push(n === CHUNK.length ? CHUNK : CHUNK.subarray(0, n));
    },
  });
}

export async function runUpload(opts: UploadOptions): Promise<PhaseResult> {
  const agent = new Agent({ connections: opts.streams + 2 });
  const controller = new AbortController();
  let totalBytes = 0;
  let bytesAtRampEnd: number | null = null;
  let rampEndAt: number | null = null;
  const start = Date.now();

  const rampTimer = setTimeout(() => {
    bytesAtRampEnd = totalBytes;
    rampEndAt = Date.now();
  }, opts.rampMs);
  const wallTimer = setTimeout(() => controller.abort(), opts.maxDurationMs);

  let progressTimer: NodeJS.Timeout | null = null;
  if (opts.onProgress) {
    let lastBytes = 0;
    let lastAt = start;
    progressTimer = setInterval(() => {
      const now = Date.now();
      const bps = ((totalBytes - lastBytes) * 8) / ((now - lastAt) / 1000);
      lastBytes = totalBytes;
      lastAt = now;
      opts.onProgress!(bps, now - start);
    }, 250);
  }

  const streamPromises = Array.from({ length: opts.streams }, async () => {
    try {
      const body = countingBody(opts.bytesPerStream, (n) => (totalBytes += n));
      const res = await request(opts.upUrl, {
        method: 'POST',
        dispatcher: agent,
        signal: controller.signal,
        body,
        headers: {
          ...SPEED_HEADERS,
          'content-type': 'application/octet-stream',
          'content-length': String(opts.bytesPerStream),
        },
        headersTimeout: opts.maxDurationMs + 10_000,
        bodyTimeout: opts.maxDurationMs + 10_000,
      });
      await res.body.dump();
    } catch {
      // Aborts are expected at the wall-clock limit.
    }
  });

  await Promise.all(streamPromises);
  clearTimeout(rampTimer);
  clearTimeout(wallTimer);
  if (progressTimer) clearInterval(progressTimer);
  await agent.close().catch(() => {});

  const end = Date.now();
  const durationMs = end - start;
  let bps: number | null = null;
  if (bytesAtRampEnd !== null && rampEndAt !== null && end > rampEndAt + 1000) {
    bps = ((totalBytes - bytesAtRampEnd) * 8) / ((end - rampEndAt) / 1000);
  } else if (durationMs > 500 && totalBytes > 0) {
    bps = (totalBytes * 8) / (durationMs / 1000);
  }
  return { bps, bytes: totalBytes, durationMs };
}
