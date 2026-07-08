import type { StatusSnapshot } from '../../../shared/types';

/**
 * Warns when the monitoring machine's own connection undermines the
 * evidence: running over WiFi (radio interference gets recorded as if it
 * were ISP trouble) or a wired port negotiated below the plan speed
 * (speed tests capped by the port, not the ISP). Renders nothing when the
 * link looks fine or couldn't be determined.
 */
export function LinkAdvisory({
  status,
  planDownMbps,
}: {
  status: StatusSnapshot;
  planDownMbps?: number | null;
}) {
  const { iface, wireless, linkSpeedMbps } = status.link;

  if (wireless === true) {
    return (
      <div className="banner">
        <span aria-hidden="true">📶</span>
        <div>
          <strong>Trapline is monitoring over WiFi{iface ? ` (${iface})` : ''}</strong>
          <div className="dim">
            WiFi interference gets recorded as if it were your ISP's fault, so results will
            overstate problems and your ISP can fairly dispute them. For evidence-grade
            results, connect this computer to your router with an Ethernet cable, then click
            “Re-discover router &amp; ISP hop” in Settings.
          </div>
        </div>
      </div>
    );
  }

  if (
    wireless === false &&
    linkSpeedMbps !== null &&
    planDownMbps != null &&
    linkSpeedMbps < planDownMbps
  ) {
    return (
      <div className="banner">
        <span aria-hidden="true">🔌</span>
        <div>
          <strong>
            Network port is limited to {linkSpeedMbps} Mbps{iface ? ` (${iface})` : ''}
          </strong>
          <div className="dim">
            Your plan is {planDownMbps} Mbps, so speed tests from this computer are capped by
            its own network port, not by the ISP. Speed results will read low; a faster port
            (or another machine) is needed to test the full plan speed. Outage and latency
            evidence is unaffected.
          </div>
        </div>
      </div>
    );
  }

  return null;
}
