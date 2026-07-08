/**
 * Latency probes for the speed test: tiny (0-byte) downloads timed
 * end-to-end. Run once on an idle line, and repeatedly *during* the
 * download/upload phases to measure bufferbloat (how badly a loaded line
 * delays everything else — the thing that makes video calls stutter).
 */
import { Agent, request } from 'undici';
import type { BufferbloatGrade } from '../../../shared/types.js';
import { SPEED_HEADERS } from './download.js';

export async function probeLatencyOnce(downUrl: string, agent: Agent): Promise<number | null> {
  const start = process.hrtime.bigint();
  try {
    const res = await request(`${downUrl}?bytes=0`, {
      method: 'GET',
      dispatcher: agent,
      headers: SPEED_HEADERS,
      headersTimeout: 5000,
      bodyTimeout: 5000,
    });
    await res.body.dump();
    if (res.statusCode !== 200) return null;
    return Number(process.hrtime.bigint() - start) / 1e6;
  } catch {
    return null;
  }
}

export async function measureIdleLatency(
  downUrl: string,
  count = 10,
  gapMs = 300,
): Promise<{ medianMs: number | null; samples: number[]; bytesUsed: number }> {
  // Dedicated agent so these probes get their own (single) connection.
  const agent = new Agent({ connections: 1 });
  const samples: number[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const ms = await probeLatencyOnce(downUrl, agent);
      if (ms !== null) samples.push(ms);
      if (i < count - 1) await new Promise((r) => setTimeout(r, gapMs));
    }
  } finally {
    await agent.close().catch(() => {});
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const medianMs = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null;
  return { medianMs, samples, bytesUsed: count * 600 };
}

/** Samples latency every `intervalMs` on its own connection until stopped. */
export class LoadedLatencySampler {
  private samples: number[] = [];
  private timer: NodeJS.Timeout | null = null;
  private agent = new Agent({ connections: 1 });
  private inFlight = false;
  bytesUsed = 0;

  constructor(
    private downUrl: string,
    private intervalMs = 500,
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      if (this.inFlight) return; // don't stack probes on a saturated line
      this.inFlight = true;
      this.bytesUsed += 600;
      void probeLatencyOnce(this.downUrl, this.agent).then((ms) => {
        this.inFlight = false;
        if (ms !== null) this.samples.push(ms);
      });
    }, this.intervalMs);
  }

  async stop(): Promise<{ medianMs: number | null }> {
    if (this.timer) clearInterval(this.timer);
    await this.agent.close().catch(() => {});
    const sorted = [...this.samples].sort((a, b) => a - b);
    return { medianMs: sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null };
  }
}

/** Grade the extra latency the line suffers under load. */
export function bufferbloatGrade(extraMs: number): BufferbloatGrade {
  if (extraMs < 15) return 'A+';
  if (extraMs < 30) return 'A';
  if (extraMs < 75) return 'B';
  if (extraMs < 150) return 'C';
  if (extraMs < 300) return 'D';
  return 'F';
}
