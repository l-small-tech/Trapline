/**
 * Plain traceroute/tracert runner, used as the ISP-first-hop discovery
 * fallback when mtr isn't available (always on Windows, commonly on macOS,
 * and on Linux without mtr-tiny). Only hop IPs are needed — no per-hop
 * statistics — so the system tools are enough.
 */
import { spawn } from 'node:child_process';
import { isPrivateIp } from './ipUtil.js';

const IPV4_RE = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/;

/**
 * Parse unix `traceroute -n` output into hop IPs (null = no response).
 * Exported for unit tests.
 */
export function parseTracerouteOutput(stdout: string): (string | null)[] {
  const hops: (string | null)[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue; // header/noise
    const hopNum = Number(m[1]);
    const ip = IPV4_RE.exec(m[2]!);
    hops[hopNum - 1] = ip ? ip[1]! : null;
  }
  return hops;
}

/**
 * Parse Windows `tracert -d` output into hop IPs (null = timed out).
 * Hop lines start with the hop number; the IP is the last token. Timeout
 * text is localized, so absence of an IP marks the timeout. Exported for
 * unit tests.
 */
export function parseTracertOutput(stdout: string): (string | null)[] {
  const hops: (string | null)[] = [];
  let sawHop = false;
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) {
      if (sawHop) break; // footer after the hop table
      continue; // header ("Tracing route to 1.1.1.1 over a maximum of…")
    }
    sawHop = true;
    const hopNum = Number(m[1]);
    const rest = m[2]!;
    // The target line of the header also starts with a digit-free-form; hop
    // rows always contain either "ms" columns or "*".
    if (!/ms|\*/.test(rest)) continue;
    const ip = IPV4_RE.exec(rest);
    hops[hopNum - 1] = ip ? ip[1]! : null;
  }
  return hops;
}

/**
 * First responding public hop that isn't the anchor itself.
 * Mirrors the mtr-based logic in discovery.ts. Exported for unit tests.
 */
export function firstPublicHop(hops: (string | null)[], anchor: string): string | null {
  for (const ip of hops) {
    if (!ip) continue;
    if (isPrivateIp(ip)) continue;
    if (ip === anchor) break; // reached the anchor — no distinct ISP hop visible
    return ip;
  }
  return null;
}

function runCollect(cmd: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out || null);
    });
  });
}

/** Trace toward `anchor` and return hop IPs, or null if no tracer exists. */
export async function traceHops(anchor: string, maxHops = 8): Promise<(string | null)[] | null> {
  if (process.platform === 'win32') {
    const out = await runCollect(
      'tracert',
      ['-d', '-h', String(maxHops), '-w', '1000', anchor],
      60_000, // tracert waits out every timeout column; it is slow
    );
    return out ? parseTracertOutput(out) : null;
  }
  const out = await runCollect(
    'traceroute',
    ['-n', '-q', '1', '-w', '1', '-m', String(maxHops), anchor],
    30_000,
  );
  return out ? parseTracerouteOutput(out) : null;
}
