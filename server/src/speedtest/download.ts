/**
 * Download throughput: N parallel HTTP streams against the configured
 * endpoint (Cloudflare's __down by default). Throughput is computed over
 * the window after `rampMs`, excluding TCP slow-start, from bytes actually
 * received — so a truncated response still measures correctly.
 */
import { Agent, request } from 'undici';

/**
 * Cloudflare's edge intermittently 403s large __down/__up requests from
 * bare HTTP clients. A browser-shaped User-Agent (still identifying
 * Trapline) and a Referer make the requests score as the official web
 * client does. Verified necessary in production.
 */
export const SPEED_HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Trapline/0.1',
  referer: 'https://speed.cloudflare.com/',
  accept: '*/*',
};

export interface PhaseResult {
  bps: number | null;
  bytes: number;
  durationMs: number;
}

export interface DownloadOptions {
  downUrl: string;
  streams: number;
  /** Bytes requested per stream. */
  bytesPerStream: number;
  maxDurationMs: number;
  rampMs: number;
  onProgress?: (bps: number, elapsedMs: number) => void;
}

/** Single-stream preflight to size the real test. */
export async function preflightDownload(
  downUrl: string,
  bytes = 10_000_000,
  maxMs = 4000,
): Promise<PhaseResult> {
  return runDownload({
    downUrl,
    streams: 1,
    bytesPerStream: bytes,
    maxDurationMs: maxMs,
    rampMs: 500,
  });
}

export async function runDownload(opts: DownloadOptions): Promise<PhaseResult> {
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
      const res = await request(`${opts.downUrl}?bytes=${opts.bytesPerStream}`, {
        method: 'GET',
        dispatcher: agent,
        signal: controller.signal,
        headers: SPEED_HEADERS,
        headersTimeout: 10_000,
        bodyTimeout: opts.maxDurationMs,
      });
      if (res.statusCode !== 200) {
        await res.body.dump();
        throw new Error(`HTTP ${res.statusCode} from speed endpoint`);
      }
      for await (const chunk of res.body) {
        totalBytes += (chunk as Buffer).length;
      }
    } catch (err) {
      // Aborts and mid-stream errors are expected; bytes already counted.
      if (process.env.TRAPLINE_DEBUG) console.error('download stream error:', err);
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
    // Test finished before the ramp window closed — fall back to naive rate.
    bps = (totalBytes * 8) / (durationMs / 1000);
  }
  return { bps, bytes: totalBytes, durationMs };
}
