/**
 * Target discovery: the default gateway (LAN) and the ISP's first visible
 * hop (the first responding public-address hop on the route out).
 *
 * The gateway-vs-ISP-hop distinction is what lets us classify outages as
 * "your WiFi/router" vs "the ISP's network" — the core of the evidence.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runMtr } from './mtr.js';

const execFileP = promisify(execFile);

export interface DiscoveredTargets {
  gateway: string | null;
  ispHop: string | null;
}

/** RFC1918 + CGNAT (100.64/10) + link-local + loopback. */
export function isPrivateIp(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // not IPv4 → treat as non-public
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

export async function discoverGateway(): Promise<string | null> {
  try {
    const { stdout } = await execFileP('ip', ['-j', 'route', 'show', 'default']);
    const routes = JSON.parse(stdout) as { gateway?: string }[];
    return routes.find((r) => r.gateway)?.gateway ?? null;
  } catch {
    return null;
  }
}

/**
 * First responding hop past the LAN with a public IP, from an mtr trace
 * toward 1.1.1.1. Some ISPs (MPLS cores) hide these hops — returns null
 * then, and the monitor runs with anchors only.
 */
export async function discoverIspHop(): Promise<string | null> {
  const { result } = await runMtr('1.1.1.1', 5);
  if (!result) return null;
  for (const hop of result.hops) {
    if (hop.ip === '???' || !hop.ip) continue;
    if (hop.lossPct >= 100) continue; // never responded
    if (isPrivateIp(hop.ip)) continue;
    if (hop.ip === '1.1.1.1') break; // reached the anchor itself — no distinct ISP hop visible
    return hop.ip;
  }
  return null;
}

export async function discoverTargets(): Promise<DiscoveredTargets> {
  const gateway = await discoverGateway();
  const ispHop = await discoverIspHop();
  return { gateway, ispHop };
}
