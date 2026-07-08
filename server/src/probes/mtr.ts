/**
 * mtr trace capture (route + per-hop loss/latency), used as attached
 * evidence when events open and for the on-demand Tools page.
 *
 * mtr needs raw-socket capability; we self-test at startup and degrade
 * gracefully (evidence just omits traces) if unavailable.
 */
import { spawn } from 'node:child_process';
import type { MtrHop, MtrResult } from '../../../shared/types.js';

export interface MtrRunResult {
  result: MtrResult | null;
  error: string | null;
}

function runCommand(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, code: null });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

interface MtrJsonHub {
  count: string | number;
  host: string;
  ip?: string;
  'Loss%': number;
  Snt: number;
  Last: number;
  Avg: number;
  Best: number;
  Wrst: number;
  StDev: number;
}

export async function runMtr(host: string, cycles = 10): Promise<MtrRunResult> {
  // -b: show both hostname and IP, -z: show AS numbers, --json output.
  const { stdout, stderr, code } = await runCommand(
    'mtr',
    ['--json', '-b', '-z', '-c', String(cycles), host],
    (cycles + 20) * 1000,
  );
  if (code !== 0 || !stdout.trim()) {
    return { result: null, error: stderr.trim() || `mtr exited with code ${code}` };
  }
  try {
    const parsed = JSON.parse(stdout) as { report?: { hubs?: MtrJsonHub[] } };
    const hubs = parsed.report?.hubs ?? [];
    const hops: MtrHop[] = hubs.map((h) => ({
      hop: Number(h.count),
      host: h.host,
      ip: h.ip ?? h.host,
      lossPct: h['Loss%'],
      sent: h.Snt,
      last: h.Last,
      avg: h.Avg,
      best: h.Best,
      worst: h.Wrst,
      stdev: h.StDev,
    }));
    return { result: { target: host, capturedAt: Date.now(), hops }, error: null };
  } catch (err) {
    return { result: null, error: `failed to parse mtr output: ${String(err)}` };
  }
}

/** Quick capability check — can mtr open its sockets on this system? */
export async function mtrSelfTest(): Promise<{ available: boolean; error: string | null }> {
  const { result, error } = await runMtr('127.0.0.1', 1);
  return { available: result !== null, error };
}
