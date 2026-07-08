/**
 * Continuous ping probe: one long-lived `ping` child process per target.
 *
 * We rely on iputils' `-O` flag, which prints
 *   "no answer yet for icmp_seq=N"
 * for every unanswered sequence number, so both successes and losses arrive
 * as lines — no timers needed to infer loss. Sequence-number gaps are also
 * detected as a belt-and-braces fallback.
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
const ERROR_RE = /(Destination .* Unreachable|Time to live exceeded|icmp_seq=(\d+).*(?:unreachable|filtered))/i;

/** Parse one line of `LANG=C ping -n -O` output. Exported for unit tests. */
export function parsePingLine(line: string): PingLine {
  const reply = REPLY_RE.exec(line);
  if (reply) return { kind: 'reply', seq: Number(reply[1]), rttMs: Number(reply[2]) };
  const timeout = TIMEOUT_RE.exec(line);
  if (timeout) return { kind: 'timeout', seq: Number(timeout[1]) };
  const err = ERROR_RE.exec(line);
  if (err) {
    const seqMatch = /icmp_seq=(\d+)/.exec(line);
    return { kind: 'error', seq: seqMatch ? Number(seqMatch[1]) : null, message: line.trim() };
  }
  return { kind: 'noise' };
}

export interface PingProbeOptions {
  host: string;
  intervalSec: number;
  onSample: (sample: PingSample) => void;
  onLog?: (msg: string) => void;
}

export class PingProbe {
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
    const interval = Math.max(0.2, this.opts.intervalSec);
    // -n numeric only, -O report outstanding replies, -W 3s per-reply wait.
    const child = spawn(
      'ping',
      ['-n', '-O', '-W', '3', '-i', String(interval), this.opts.host],
      { env: { ...process.env, LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
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
