import type { StatusSnapshot } from '../../../shared/types';
import { fmtDuration } from '../api/client';
import { Tooltip } from './Tooltip';

const STATE = {
  up: {
    color: 'var(--good)',
    title: 'Connection is up',
    help: 'All internet-side probe targets are answering. Trapline keeps checking around the clock.',
  },
  degraded: {
    color: 'var(--warning)',
    title: 'Connection is degraded',
    help: 'The line is technically up but something is wrong — packet loss, high latency, or DNS trouble. See the open events below.',
  },
  down: {
    color: 'var(--critical)',
    title: 'Connection is DOWN',
    help: 'None of the internet-side probe targets are reachable. Trapline is recording this outage with exact timestamps.',
  },
} as const;

export function StatusHero({ status }: { status: StatusSnapshot }) {
  const s = STATE[status.state];
  const since = Date.now() - status.stateSince;
  const openIsp = status.openEvents.find((e) => e.classification === 'isp');
  return (
    <div className="card hero" style={{ color: s.color }}>
      <span className="hero-dot" style={{ background: s.color }} />
      <div style={{ color: 'var(--ink)' }}>
        <div className="hero-state">
          {s.title} <Tooltip text={s.help} />
        </div>
        <div className="hero-sub">
          for {fmtDuration(since)}
          {status.state !== 'up' && openIsp && ' — your router is fine; the problem is on the ISP side'}
          {status.state === 'down' &&
            status.openEvents.some((e) => e.classification === 'lan') &&
            ' — your own router is not responding; check your home equipment first'}
        </div>
      </div>
    </div>
  );
}
