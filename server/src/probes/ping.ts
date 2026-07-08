/**
 * Continuous ping probe, one strategy per platform:
 *
 * - linux: one long-lived iputils `ping -O` per target. `-O` prints
 *   "no answer yet for icmp_seq=N" for every unanswered sequence number,
 *   so both successes and losses arrive as lines — no timers needed.
 * - darwin: one long-lived BSD `ping` per target. BSD ping prints
 *   "Request timeout for icmp_seq N" for unanswered probes. Non-root may
 *   not use sub-second intervals, so the interval clamps to >= 1 s.
 * - win32: ping.exe cannot stream with per-reply timeout control, so a
 *   loop spawns one `ping -n 1` per interval. Output is localized;
 *   detection keys on the locale-stable "TTL=" token and the "NNms" value.
 *
 * On all platforms sequence-number gaps are also detected as a
 * belt-and-braces fallback (losses that produced no line at all).
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import readline from 'node:readline';
import type { Readable } from 'node:stream';

export interface PingSample {
  ts: number;
  /** RTT in ms, or null for a lost/unanswered probe. */
  rttMs: number | null;
  seq: number;
}

export type PingLine =
  | { kind: 'reply'; seq: number; rttMs: number }
  | { kind: 'timeout'; seq: number }
  | { kind: 'error'; seq: number | null; message: string }
  | { kind: 'noise' };

const REPLY_RE = /icmp_seq=(\d+)(?:\s+ttl=\d+)?\s+time=([\d.]+)\s*ms/;
const TIMEOUT_RE = /no answer yet for icmp_seq[= ](\d+)/;
const DARWIN_TIMEOUT_RE = /Request timeout for icmp_seq[= ]?(\d+)/;
const ERROR_RE = /(Destination .* Unreachable|Time to live exceeded|icmp_seq=(\d+).*(?:unreachable|filtered))/i;

/**
 * Parse one line of long-lived `LANG=C ping -n` output (iputils or BSD).
 * Exported for unit tests.
 */
export function parsePingLine(line: string): PingLine {
  const reply = REPLY_RE.exec(line);
  if (reply) return { kind: 'reply', seq: Number(reply[1]), rttMs: Number(reply[2]) };
  const timeout = TIMEOUT_RE.exec(line) ?? DARWIN_TIMEOUT_RE.exec(line);
  if (timeout) return { kind: 'timeout', seq: Number(timeout[1]) };
  const err = ERROR_RE.exec(line);
  if (err) {
    const seqMatch = /icmp_seq=(\d+)/.exec(line);
    return { kind: 'error', seq: seqMatch ? Number(seqMatch[1]) : null, message: line.trim() };
  }
  return { kind: 'noise' };
}

export type WindowsPingLine =
  | { kind: 'reply'; rttMs: number }
  | { kind: 'timeout' }
  | { kind: 'error'; message: string }
  | { kind: 'noise' };

// ping.exe output is localized ("Reply from" / "Antwort von" / …) but the
// "TTL=" token and the "<n>ms" value survive translation.
const WIN_TTL_RE = /TTL=\d+/i;
const WIN_RTT_RE = /[=<]\s*(\d+(?:[.,]\d+)?)\s*ms/i;
const WIN_TIMEOUT_RE = /Request timed out|100% loss/i;
const WIN_ERROR_RE = /(unreachable|General failure|transmit failed|could not find host|TTL expired)/i;

/** Parse one line of `ping.exe` output. Exported for unit tests. */
export function parseWindowsPingLine(line: string): WindowsPingLine {
  if (WIN_TTL_RE.test(line)) {
    const rtt = WIN_RTT_RE.exec(line);
    // "time<1ms" reports as 1; a reply line without a parsable time is noise.
    if (rtt) return { kind: 'reply', rttMs: Math.max(1, Number(rtt[1]!.replace(',', '.'))) };
    return { kind: 'reply', rttMs: 1 };
  }
  if (WIN_TIMEOUT_RE.test(line)) return { kind: 'timeout' };
  if (WIN_ERROR_RE.test(line)) return { kind: 'error', message: line.trim() };
  return { kind: 'noise' };
}

/** Arguments for the long-lived unix ping. Exported for unit tests. */
export function buildPingArgs(
  platform: NodeJS.Platform,
  host: string,
  intervalSec: number,
  isRoot: boolean,
): string[] {
  if (platform === 'darwin') {
    // BSD ping: no -O / per-reply -W; non-root may not go below 1 s.
    const interval = isRoot ? Math.max(0.2, intervalSec) : Math.max(1, intervalSec);
    return ['-n', '-i', String(interval), host];
  }
  // iputils: -n numeric only, -O report outstanding replies, -W 3s per-reply wait.
  return ['-n', '-O', '-W', '3', '-i', String(Math.max(0.2, intervalSec)), host];
}

export interface PingProbeOptions {
  host: string;
  intervalSec: number;
  onSample: (sample: PingSample) => void;
  onLog?: (msg: string) => void;
}

export interface PingProbeLike {
  start(): void;
  stop(): void;
}

/** Long-lived ping child process (linux and darwin). */
export class PingProbe implements PingProbeLike {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private stopped = false;
  private restartDelayMs = 1000;
  private restartTimer: NodeJS.Timeout | null = null;
  private lastSeq: number | null = null;
  /** Sequence numbers already reported (a timeout may later get a late reply — first report wins). */
  private reportedSeqs = new Set<number>();

  constructor(private opts: PingProbeOptions) {}

  start(): void {
    this.stopped = false;
    this.spawnChild();
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
  }

  private log(msg: string): void {
    this.opts.onLog?.(`[ping ${this.opts.host}] ${msg}`);
  }

  private spawnChild(): void {
    if (this.stopped) return;
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    const args = buildPingArgs(process.platform, this.opts.host, this.opts.intervalSec, isRoot);
    const child = spawn('ping', args, {
      env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    this.lastSeq = null;
    this.reportedSeqs.clear();

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      this.restartDelayMs = 1000; // healthy output resets backoff
      this.handleLine(line);
    });
    child.stderr.on('data', (d: Buffer) => this.log(`stderr: ${d.toString().trim()}`));
    child.on('exit', (code, signal) => {
      rl.close();
      if (this.stopped) return;
      this.log(`exited (code=${code} signal=${signal}), restarting in ${this.restartDelayMs}ms`);
      this.restartTimer = setTimeout(() => this.spawnChild(), this.restartDelayMs);
      this.restartDelayMs = Math.min(this.restartDelayMs * 2, 60_000);
    });
    child.on('error', (err) => {
      this.log(`spawn error: ${err.message}`);
    });
  }

  private report(seq: number, rttMs: number | null): void {
    if (this.reportedSeqs.has(seq)) return;
    this.reportedSeqs.add(seq);
    // Bound the memory of the de-dupe set.
    if (this.reportedSeqs.size > 4096) {
      const cutoff = seq - 2048;
      for (const s of this.reportedSeqs) if (s < cutoff) this.reportedSeqs.delete(s);
    }
    this.opts.onSample({ ts: Date.now(), rttMs, seq });
  }

  private handleLine(line: string): void {
    const parsed = parsePingLine(line);
    if (parsed.kind === 'noise') return;

    const seq = parsed.seq;
    if (seq !== null) {
      // Belt-and-braces: any skipped sequence numbers are losses that
      // produced no line at all.
      if (this.lastSeq !== null && seq > this.lastSeq + 1) {
        for (let missing = this.lastSeq + 1; missing < seq; missing++) {
          this.report(missing, null);
        }
      }
      if (this.lastSeq === null || seq > this.lastSeq) this.lastSeq = seq;
    }

    if (parsed.kind === 'reply') this.report(parsed.seq, parsed.rttMs);
    else if (parsed.kind === 'timeout') this.report(parsed.seq, null);
    else if (parsed.kind === 'error' && parsed.seq !== null) this.report(parsed.seq, null);
  }
}

/**
 * Windows strategy: one short-lived `ping -n 1` per interval. ping.exe has
 * no continuous mode with usable per-reply timeouts, and its interval is
 * not configurable, so the loop owns the cadence (>= 1 s) and synthesizes
 * sequence numbers.
 */
export class WindowsPingLoop implements PingProbeLike {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private seq = 0;

  constructor(private opts: PingProbeOptions) {}

  start(): void {
    const intervalMs = Math.max(1, this.opts.intervalSec) * 1000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): Promise<void> {
    if (this.inFlight) return Promise.resolve(); // never overlap probes
    this.inFlight = true;
    const seq = this.seq++;
    return new Promise((resolve) => {
      const child = spawn('ping', ['-n', '1', '-w', '3000', this.opts.host], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let out = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      const killTimer = setTimeout(() => child.kill(), 10_000);
      const finish = (rttMs: number | null): void => {
        clearTimeout(killTimer);
        this.inFlight = false;
        this.opts.onSample({ ts: Date.now(), rttMs, seq });
        resolve();
      };
      child.on('error', (err) => {
        this.opts.onLog?.(`[ping ${this.opts.host}] spawn error: ${err.message}`);
        finish(null);
      });
      child.on('close', () => {
        for (const line of out.split(/\r?\n/)) {
          const parsed = parseWindowsPingLine(line);
          if (parsed.kind === 'reply') return finish(parsed.rttMs);
          if (parsed.kind === 'timeout' || parsed.kind === 'error') return finish(null);
        }
        finish(null); // no recognizable output at all counts as a loss
      });
    });
  }
}

export function createPingProbe(opts: PingProbeOptions): PingProbeLike {
  return process.platform === 'win32' ? new WindowsPingLoop(opts) : new PingProbe(opts);
}
