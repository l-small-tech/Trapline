import { useState } from 'react';
import type { EventClassification, MonitorEvent } from '../../../shared/types';
import { fmtDuration, fmtTime } from '../api/client';
import { EventDetail } from './EventDetail';
import { Tooltip } from './Tooltip';

const SEV_COLOR: Record<string, string> = {
  info: 'var(--muted)',
  minor: 'var(--warning)',
  major: 'var(--serious)',
  critical: 'var(--critical)',
};

const KIND_LABEL: Record<string, string> = {
  outage: 'Outage',
  latency_spike: 'Latency spike',
  packet_loss: 'Packet loss',
  dns_failure: 'DNS failure',
  speed_degradation: 'Slow speed',
  monitor_gap: 'Monitor offline',
};

export function classificationLabel(c: EventClassification): { text: string; help: string } {
  switch (c) {
    case 'isp':
      return {
        text: 'ISP fault',
        help: 'Your router stayed reachable while the ISP network did not — the problem was on their side, not in your home.',
      };
    case 'lan':
      return {
        text: 'Home network',
        help: 'Your own router was unreachable too, so this looks like a problem inside your home (WiFi, router, cabling) — not the ISP. These events are excluded from ISP claims.',
      };
    case 'upstream':
      return {
        text: 'Upstream',
        help: 'The ISP first hop stayed reachable but destinations beyond it did not — likely a problem further out on the internet.',
      };
    default:
      return {
        text: 'Undetermined',
        help: 'There was not enough signal to say whose fault this was.',
      };
  }
}

export function EventsTimeline({ events }: { events: MonitorEvent[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (events.length === 0) {
    return <p className="dim">No events recorded — a quiet line is a good line.</p>;
  }
  return (
    <div className="table-scroll">
      <table className="data">
        <thead>
          <tr>
            <th>When</th>
            <th>What</th>
            <th>Duration</th>
            <th>Severity</th>
            <th>
              Fault{' '}
              <Tooltip text="Trapline compares your router vs the ISP network during each event to work out where the problem was. 'ISP fault' events are the evidence that matters." />
            </th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const cls = classificationLabel(e.classification);
            return (
              <FragmentRow
                key={e.id}
                event={e}
                cls={cls}
                open={openId === e.id}
                onToggle={() => setOpenId(openId === e.id ? null : e.id)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({
  event: e,
  cls,
  open,
  onToggle,
}: {
  event: MonitorEvent;
  cls: { text: string; help: string };
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr>
        <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(e.startedAt)}</td>
        <td>
          <strong>{KIND_LABEL[e.kind] ?? e.kind}</strong>
          <div className="dim">{e.summary}</div>
        </td>
        <td className="num">
          {e.endedAt === null ? (
            <span style={{ color: 'var(--critical)' }}>ongoing</span>
          ) : (
            fmtDuration(e.endedAt - e.startedAt)
          )}
        </td>
        <td>
          <span className="badge" style={{ borderColor: SEV_COLOR[e.severity], color: SEV_COLOR[e.severity] }}>
            {e.severity}
          </span>
        </td>
        <td>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span className="chip">{cls.text}</span>
            <Tooltip text={cls.help} />
          </span>
        </td>
        <td>
          <button type="button" className="btn" style={{ padding: '3px 10px', fontSize: 12 }} onClick={onToggle}>
            {open ? 'Hide' : 'Details'}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} style={{ background: 'var(--surface-2)', borderRadius: 8 }}>
            <EventDetail eventId={e.id} />
          </td>
        </tr>
      )}
    </>
  );
}
