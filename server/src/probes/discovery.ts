/**
 * Target discovery: the default gateway (LAN) and the ISP's first visible
 * hop (the first responding public-address hop on the route out).
 *
 * The gateway-vs-ISP-hop distinction is what lets us classify outages as
 * "your WiFi/router" vs "the ISP's network" — the core of the evidence.
 *
 * Gateway lookup is per-platform: `ip -j route` (Linux), `route -n get
 * default` (macOS), `Get-NetRoute` via PowerShell (Windows). The ISP hop
 * comes from mtr when available, else a plain traceroute/tracert.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isPrivateIp } from './ipUtil.js';
import { runMtr } from './mtr.js';
import { firstPublicHop, traceHops } from './traceroute.js';

const execFileP = promisify(execFile);

export { isPrivateIp }; // re-export: this was its home before ipUtil.ts

export interface DiscoveredTargets {
  gateway: string | null;
  ispHop: string | null;
}

const ANCHOR = '1.1.1.1';

/** Parse `route -n get default` (macOS). Exported for unit tests. */
export function parseDarwinRouteGet(stdout: string): { gateway: string | null; iface: string | null } {
  const gw = /^\s*gateway:\s*(\S+)/m.exec(stdout);
  const ifc = /^\s*interface:\s*(\S+)/m.exec(stdout);
  return { gateway: gw ? gw[1]! : null, iface: ifc ? ifc[1]! : null };
}

/**
 * Parse `Get-NetRoute … | ConvertTo-Json` output (Windows). PowerShell
 * emits a bare object for one row and an array for several; tolerate a BOM
 * and blank output. Exported for unit tests.
 */
export function parseWindowsRouteJson(stdout: string): { nextHop: string | null; interfaceIndex: number | null } {
  const none = { nextHop: null, interfaceIndex: null };
  const text = stdout.replace(/^\uFEFF/, '').trim();
  if (!text) return none;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return none;
  }
  const row = (Array.isArray(parsed) ? parsed[0] : parsed) as
    | { NextHop?: unknown; InterfaceIndex?: unknown }
    | undefined;
  if (!row) return none;
  return {
    nextHop: typeof row.NextHop === 'string' && row.NextHop !== '0.0.0.0' ? row.NextHop : null,
    interfaceIndex: typeof row.InterfaceIndex === 'number' ? row.InterfaceIndex : null,
  };
}

export const WINDOWS_ROUTE_COMMAND =
  'Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Sort-Object RouteMetric,InterfaceMetric | ' +
  'Select-Object -First 1 NextHop,InterfaceIndex | ConvertTo-Json';

async function darwinGateway(): Promise<string | null> {
  try {
    const { stdout } = await execFileP('route', ['-n', 'get', 'default']);
    return parseDarwinRouteGet(stdout).gateway;
  } catch {
    return null;
  }
}

async function windowsGateway(): Promise<string | null> {
  try {
    const { stdout } = await execFileP('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      WINDOWS_ROUTE_COMMAND,
    ]);
    return parseWindowsRouteJson(stdout).nextHop;
  } catch {
    return null;
  }
}

async function linuxGateway(): Promise<string | null> {
  try {
    const { stdout } = await execFileP('ip', ['-j', 'route', 'show', 'default']);
    const routes = JSON.parse(stdout) as { gateway?: string }[];
    return routes.find((r) => r.gateway)?.gateway ?? null;
  } catch {
    return null;
  }
}

export async function discoverGateway(): Promise<string | null> {
  switch (process.platform) {
    case 'darwin':
      return darwinGateway();
    case 'win32':
      return windowsGateway();
    default:
      return linuxGateway();
  }
}

/**
 * First responding hop past the LAN with a public IP, from a trace toward
 * 1.1.1.1 (mtr when available, plain traceroute otherwise). Some ISPs
 * (MPLS cores) hide these hops — returns null then, and the monitor runs
 * with anchors only.
 */
export async function discoverIspHop(): Promise<string | null> {
  const { result } = await runMtr(ANCHOR, 5);
  if (result) {
    for (const hop of result.hops) {
      if (hop.ip === '???' || !hop.ip) continue;
      if (hop.lossPct >= 100) continue; // never responded
      if (isPrivateIp(hop.ip)) continue;
      if (hop.ip === ANCHOR) break; // reached the anchor itself — no distinct ISP hop visible
      return hop.ip;
    }
    return null;
  }
  const hops = await traceHops(ANCHOR);
  return hops ? firstPublicHop(hops, ANCHOR) : null;
}

export async function discoverTargets(): Promise<DiscoveredTargets> {
  const gateway = await discoverGateway();
  const ispHop = await discoverIspHop();
  return { gateway, ispHop };
}
