import { useEffect, useState } from 'react';
import type { MonitorEvent, MtrResult, PingPoint } from '../../../shared/types';
import { api, fmtTime } from '../api/client';

type Detail = MonitorEvent & {
  evidence: { kind: string; capturedAt: number; content: unknown }[];
};

interface PingWindow {
  from: number;
  to: number;
  truncated: boolean;
  targets: { id: number; host: string; label: string }[];
  samples: PingPoint[];
}

/** Attached evidence for one event: mtr hop tables + ping-window summary. */
export function EventDetail({ eventId }: { eventId: number }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .eventDetail(eventId)
      .then(setDetail)
      .catch((e: Error) => setError(e.message));
  }, [eventId]);

  if (error) return <p className="dim">Could not load details: {error}</p>;
  if (!detail) return <span className="spin" />;

  const mtrs = detail.evidence.filter((e) => e.kind === 'mtr');
  const windows = detail.evidence.filter((e) => e.kind === 'ping_window');

  return (
    <div style={{ padding: '10px 4px', display: 'grid', gap: 14 }}>
      <div className="dim">
        Exact start: {new Date(detail.startedAt).toISOString()} (UTC) · {fmtTime(detail.startedAt)} (local)
        {detail.endedAt !== null && (
          <>
            <br />
            Exact end: {new Date(detail.endedAt).toISOString()} (UTC) · {fmtTime(detail.endedAt)} (local)
          </>
        )}
      </div>

      {windows.map((w, i) => {
        const win = w.content as PingWindow;
        const byTarget = win.targets.map((t) => {
          const samples = win.samples.filter((s) => s.targetId === t.id);
          const lost = samples.filter((s) => s.rttMs === null).length;
          return { ...t, total: samples.length, lost };
        });
        return (
          <div key={i}>
            <strong style={{ fontSize: 12.5 }}>
              Raw probe record (±2 min around the event){win.truncated ? ' — truncated' : ''}
            </strong>
            <table className="data" style={{ maxWidth: 480 }}>
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Probes</th>
                  <th>Lost</th>
                </tr>
              </thead>
              <tbody>
                {byTarget.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.label} <span className="dim">({t.host})</span>
                    </td>
                    <td className="num">{t.total}</td>
                    <td className="num" style={{ color: t.lost > 0 ? 'var(--critical)' : undefined }}>
                      {t.lost}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {mtrs.map((m, i) => {
        const mtr = m.content as MtrResult;
        return (
          <div key={i}>
            <strong style={{ fontSize: 12.5 }}>
              Route trace to {mtr.target} at {fmtTime(mtr.capturedAt)} (where packets died)
            </strong>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Hop</th>
                    <th>Loss</th>
                    <th>Avg RTT</th>
                    <th>Worst</th>
                  </tr>
                </thead>
                <tbody>
                  {mtr.hops.map((h) => (
                    <tr key={h.hop}>
                      <td className="num">{h.hop}</td>
                      <td>
                        {h.host} {h.ip !== h.host && <span className="dim">({h.ip})</span>}
                      </td>
                      <td className="num" style={{ color: h.lossPct > 0 ? 'var(--critical)' : undefined }}>
                        {h.lossPct.toFixed(0)}%
                      </td>
                      <td className="num">{h.avg.toFixed(1)} ms</td>
                      <td className="num">{h.worst.toFixed(1)} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {mtrs.length === 0 && windows.length === 0 && (
        <p className="dim">No attached evidence for this event.</p>
      )}
    </div>
  );
}
