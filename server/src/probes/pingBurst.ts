/**
 * One-shot ping burst for the Tools page and health check. Arg-array
 * spawn, never a shell. Per-platform flags mirror probes/ping.ts.
 */
import { spawn } from 'node:child_process';
import { parsePingLine, parseWindowsPingLine } from './ping.js';

export interface PingBurstResult {
  rtts: (number | null)[];
  medianRttMs: number | null;
  lossPct: number;
}

/** Burst arguments per platform. Exported for unit tests. */
export function buildBurstArgs(
  platform: NodeJS.Platform,
  host: string,
  count: number,
  isRoot: boolean,
): string[] {
  switch (platform) {
    case 'win32':
      return ['-n', String(count), '-w', '2000', host];
    case 'darwin':
      // Non-root BSD ping rejects sub-second intervals.
      return ['-n', '-c', String(count), '-i', isRoot ? '0.3' : '1', host];
    default:
      return ['-n', '-O', '-W', '2', '-i', '0.3', '-c', String(count), host];
  }
}

function summarize(rtts: (number | null)[]): PingBurstResult {
  const ok = rtts.filter((r): r is number => r !== null).sort((a, b) => a - b);
  return {
    rtts,
    medianRttMs: ok.length ? ok[Math.floor(ok.length / 2)]! : null,
    lossPct: rtts.length ? ((rtts.length - ok.length) / rtts.length) * 100 : 100,
  };
}

export async function pingBurst(host: string, count: number): Promise<PingBurstResult> {
  return new Promise((resolve) => {
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    const child = spawn('ping', buildBurstArgs(process.platform, host, count, isRoot), {
      env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const rtts: (number | null)[] = [];
    let buf = '';
    const isWin = process.platform === 'win32';
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (isWin) {
          const parsed = parseWindowsPingLine(line);
          if (parsed.kind === 'reply') rtts.push(parsed.rttMs);
          else if (parsed.kind === 'timeout' || parsed.kind === 'error') rtts.push(null);
        } else {
          const parsed = parsePingLine(line);
          if (parsed.kind === 'reply') rtts.push(parsed.rttMs);
          else if (parsed.kind === 'timeout' || (parsed.kind === 'error' && parsed.seq !== null)) rtts.push(null);
        }
      }
    });
    // Worst case on darwin non-root the burst takes count seconds; leave slack.
    const timer = setTimeout(() => child.kill('SIGKILL'), (count * 2 + 10) * 1000);
    child.on('close', () => {
      clearTimeout(timer);
      resolve(summarize(rtts));
    });
    child.on('error', () => resolve({ rtts: [], medianRttMs: null, lossPct: 100 }));
  });
}
