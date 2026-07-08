/**
 * Detects how this machine itself is connected to the router: which
 * interface carries the default route, whether that interface is WiFi,
 * and — for wired NICs — the negotiated link rate.
 *
 * Why: Trapline's evidence is only as good as its vantage point. A monitor
 * on WiFi records radio interference as if it were ISP trouble, and a NIC
 * negotiated at 100 Mbps caps every speed test below a faster plan. The UI
 * warns about both. Detection is best-effort: on layouts where /sys doesn't
 * describe the interface (some containers/VMs), fields stay null and no
 * warning is shown.
 */
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { LinkInfo } from '../../../shared/types.js';

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

export async function detectLinkInfo(): Promise<LinkInfo> {
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
