/**
 * Detects how this machine itself is connected to the router: which
 * interface carries the default route, whether that interface is WiFi,
 * and — where the OS reports it — the negotiated link rate.
 *
 * Why: Trapline's evidence is only as good as its vantage point. A monitor
 * on WiFi records radio interference as if it were ISP trouble, and a NIC
 * negotiated at 100 Mbps caps every speed test below a faster plan. The UI
 * warns about both. Detection is best-effort on every platform: whenever
 * the OS doesn't describe the interface (containers, VMs, odd drivers),
 * fields stay null and no warning is shown.
 */
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { LinkInfo } from '../../../shared/types.js';
import { parseDarwinRouteGet } from './discovery.js';

const execFileP = promisify(execFile);

const UNKNOWN: LinkInfo = { iface: null, wireless: null, linkSpeedMbps: null };

/** Interface name of the first default route, from `ip -j route show default`. */
export function defaultRouteIface(routes: { dev?: string }[]): string | null {
  const dev = routes.find((r) => typeof r.dev === 'string' && r.dev !== '')?.dev ?? null;
  // Interface names come from the kernel, but they end up in /sys paths —
  // accept only benign characters.
  return dev !== null && /^[a-zA-Z0-9:._-]{1,64}$/.test(dev) ? dev : null;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function detectLinkInfoLinux(): Promise<LinkInfo> {
  let iface: string | null;
  try {
    const { stdout } = await execFileP('ip', ['-j', 'route', 'show', 'default']);
    iface = defaultRouteIface(JSON.parse(stdout) as { dev?: string }[]);
  } catch {
    return UNKNOWN;
  }
  if (iface === null) return UNKNOWN;

  const sysDir = `/sys/class/net/${iface}`;
  // If /sys doesn't describe the interface we can't tell wired from WiFi;
  // report the interface name but leave the verdict null (no warning).
  if (!(await exists(sysDir))) return { iface, wireless: null, linkSpeedMbps: null };

  const wireless = (await exists(`${sysDir}/wireless`)) || (await exists(`${sysDir}/phy80211`));

  let linkSpeedMbps: number | null = null;
  if (!wireless) {
    try {
      const speed = Number.parseInt(await readFile(`${sysDir}/speed`, 'utf8'), 10);
      // Drivers report -1 (or fail with EINVAL) when no rate is negotiated.
      if (Number.isFinite(speed) && speed > 0) linkSpeedMbps = speed;
    } catch {
      // virtual NICs often have no speed attribute — fine, stays null
    }
  }
  return { iface, wireless, linkSpeedMbps };
}

/**
 * Parse `networksetup -listallhardwareports` (macOS) into device → port
 * name ("Wi-Fi", "Ethernet", …). Exported for unit tests.
 */
export function parseHardwarePorts(stdout: string): Map<string, string> {
  const ports = new Map<string, string>();
  let currentPort: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const port = /^Hardware Port:\s*(.+)$/.exec(line);
    if (port) {
      currentPort = port[1]!.trim();
      continue;
    }
    const dev = /^Device:\s*(\S+)/.exec(line);
    if (dev && currentPort) ports.set(dev[1]!, currentPort);
  }
  return ports;
}

/** Parse the `media:` line of `ifconfig <if>` into Mbps. Exported for unit tests. */
export function parseIfconfigMediaMbps(stdout: string): number | null {
  // e.g. "media: autoselect (1000baseT <full-duplex>)"
  const m = /media:.*?\((\d+)base/i.exec(stdout);
  if (m) return Number(m[1]);
  if (/media:.*?\b10G(?:base|BASE)/.exec(stdout)) return 10_000;
  return null;
}

async function detectLinkInfoDarwin(): Promise<LinkInfo> {
  let iface: string | null;
  try {
    const { stdout } = await execFileP('route', ['-n', 'get', 'default']);
    iface = parseDarwinRouteGet(stdout).iface;
  } catch {
    return UNKNOWN;
  }
  if (iface === null || !/^[a-zA-Z0-9:._-]{1,64}$/.test(iface)) return UNKNOWN;

  let wireless: boolean | null = null;
  try {
    const { stdout } = await execFileP('networksetup', ['-listallhardwareports']);
    const portName = parseHardwarePorts(stdout).get(iface);
    if (portName) wireless = /wi-?fi|airport/i.test(portName);
  } catch {
    // stays null — no warning
  }

  let linkSpeedMbps: number | null = null;
  if (wireless === false) {
    try {
      const { stdout } = await execFileP('ifconfig', [iface]);
      linkSpeedMbps = parseIfconfigMediaMbps(stdout);
    } catch {
      // stays null
    }
  }
  return { iface, wireless, linkSpeedMbps };
}

/**
 * Parse `Get-NetAdapter … | ConvertTo-Json` (Windows) into LinkInfo.
 * NdisPhysicalMedium 9 = Native802_11. Exported for unit tests.
 */
export function parseWindowsAdapterJson(stdout: string): LinkInfo {
  const text = stdout.replace(/^\uFEFF/, '').trim();
  if (!text) return UNKNOWN;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return UNKNOWN;
  }
  const row = (Array.isArray(parsed) ? parsed[0] : parsed) as
    | { Name?: unknown; PhysicalMediaType?: unknown; NdisPhysicalMedium?: unknown; LinkSpeed?: unknown }
    | undefined;
  if (!row) return UNKNOWN;

  const iface = typeof row.Name === 'string' && row.Name !== '' ? row.Name : null;
  const media = typeof row.PhysicalMediaType === 'string' ? row.PhysicalMediaType : '';
  const wireless =
    row.NdisPhysicalMedium === 9 || /802\.11|wireless/i.test(media)
      ? true
      : media || typeof row.NdisPhysicalMedium === 'number'
        ? false
        : null;

  let linkSpeedMbps: number | null = null;
  if (typeof row.LinkSpeed === 'string') {
    // "432 Mbps", "1 Gbps", "2.5 Gbps"
    const m = /([\d.]+)\s*(G|M|K)bps/i.exec(row.LinkSpeed);
    if (m) {
      const factor = m[2]!.toUpperCase() === 'G' ? 1000 : m[2]!.toUpperCase() === 'K' ? 0.001 : 1;
      linkSpeedMbps = Math.round(Number(m[1]) * factor);
    }
  } else if (typeof row.LinkSpeed === 'number' && row.LinkSpeed > 0) {
    linkSpeedMbps = Math.round(row.LinkSpeed / 1_000_000); // bits/s → Mbps
  }
  // Only wired link rates matter for the "NIC caps your speed test" warning.
  if (wireless !== false) linkSpeedMbps = null;
  return { iface, wireless, linkSpeedMbps };
}

export const WINDOWS_ADAPTER_COMMAND =
  '$idx = (Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Sort-Object RouteMetric,InterfaceMetric | Select-Object -First 1).InterfaceIndex; ' +
  'Get-NetAdapter -InterfaceIndex $idx | Select-Object Name,InterfaceDescription,PhysicalMediaType,NdisPhysicalMedium,LinkSpeed | ConvertTo-Json';

async function detectLinkInfoWin32(): Promise<LinkInfo> {
  try {
    const { stdout } = await execFileP('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      WINDOWS_ADAPTER_COMMAND,
    ]);
    return parseWindowsAdapterJson(stdout);
  } catch {
    return UNKNOWN;
  }
}

export async function detectLinkInfo(): Promise<LinkInfo> {
  switch (process.platform) {
    case 'darwin':
      return detectLinkInfoDarwin();
    case 'win32':
      return detectLinkInfoWin32();
    default:
      return detectLinkInfoLinux();
  }
}
