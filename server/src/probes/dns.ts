/**
 * DNS probes: timed lookups against the system resolver (what the user's
 * machine actually uses) and, for the benchmark tool, explicit public
 * resolvers.
 */
import dns from 'node:dns';

export interface DnsProbeResult {
  ts: number;
  resolver: string; // 'system' or an IP
  hostname: string;
  durationMs: number | null;
  success: boolean;
  error: string | null;
}

const TIMEOUT_MS = 2000;

export async function timedResolve(
  hostname: string,
  resolverIp: string | null,
): Promise<DnsProbeResult> {
  const resolver = new dns.promises.Resolver({ timeout: TIMEOUT_MS, tries: 1 });
  if (resolverIp) resolver.setServers([resolverIp]);
  const ts = Date.now();
  const start = process.hrtime.bigint();
  try {
    await resolver.resolve4(hostname);
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    return { ts, resolver: resolverIp ?? 'system', hostname, durationMs, success: true, error: null };
  } catch (err) {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    return {
      ts,
      resolver: resolverIp ?? 'system',
      hostname,
      durationMs,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The system resolver as node:dns sees it. Note: on systemd-resolved hosts
 * this is usually 127.0.0.53 — that's still "what the machine uses", which
 * is what we want to measure.
 */
export function systemResolverAddress(): string {
  return dns.getServers()[0] ?? 'unknown';
}

export const BENCH_RESOLVERS: { ip: string | null; label: string }[] = [
  { ip: null, label: 'System resolver' },
  { ip: '1.1.1.1', label: 'Cloudflare (1.1.1.1)' },
  { ip: '8.8.8.8', label: 'Google (8.8.8.8)' },
  { ip: '9.9.9.9', label: 'Quad9 (9.9.9.9)' },
];

export const BENCH_HOSTNAMES = [
  'www.google.com',
  'www.wikipedia.org',
  'www.northwestel.net',
  'www.cbc.ca',
  'example.com',
];
