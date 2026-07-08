import { useMemo, useState } from 'react';
import type { UsageBucket, UsageCategory } from '../../../shared/types';
import { fmtBytes } from '../api/client';
import { Tooltip } from './Tooltip';

/** Fixed category → color slot mapping (identity never changes with rank). */
const CATS: { cat: UsageCategory; label: string; colorVar: string }[] = [
  { cat: 'speedtest', label: 'Speed tests', colorVar: '--series-1' },
  { cat: 'ping', label: 'Pings', colorVar: '--series-2' },
  { cat: 'http', label: 'Web checks', colorVar: '--series-3' },
  { cat: 'dns', label: 'DNS checks', colorVar: '--series-5' },
  { cat: 'mtr', label: 'Route traces', colorVar: '--series-6' },
];

function bucketLabel(ts: number, granularity: string): string {
  const d = new Date(ts);
  switch (granularity) {
    case 'hour':
      return `${d.getHours()}:00`;
    case 'month':
      return d.toLocaleString(undefined, { month: 'short', year: '2-digit' });
    case 'year':
      return String(d.getFullYear());
    default:
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric' });
  }
}

/**
 * Stacked columns of measurement data used per period (internet-side only —
 * pings to your own router don't count against a data cap). HTML/CSS bars
 * with 2px surface gaps between stacked segments; hover shows exact bytes.
 */
export function UsageChart({
  buckets,
  granularity,
}: {
  buckets: UsageBucket[];
  granularity: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<number, Partial<Record<UsageCategory, number>>>();
    for (const b of buckets) {
      if (b.isLan) continue;
      const cur = map.get(b.bucketStart) ?? {};
      cur[b.category] = (cur[b.category] ?? 0) + b.bytesSent + b.bytesRecv;
      map.set(b.bucketStart, cur);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, cats]) => ({
        ts,
        cats,
        total: Object.values(cats).reduce((s, v) => s + (v ?? 0), 0),
      }));
  }, [buckets]);

  if (grouped.length === 0) return <p className="dim">No usage recorded yet for this period.</p>;

  const max = Math.max(...grouped.map((g) => g.total));
  const CHART_H = 180;

  return (
    <div>
      <div className="legend" style={{ marginBottom: 10 }}>
        {CATS.map((c) => (
          <span key={c.cat}>
            <span className="key" style={{ background: `var(${c.colorVar})` }} />
            {c.label}
          </span>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 4,
          height: CHART_H + 24,
          borderBottom: '1px solid var(--baseline)',
          overflowX: 'auto',
          paddingBottom: 0,
        }}
      >
        {grouped.map((g, i) => (
          <div
            key={g.ts}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{
              display: 'flex',
              flexDirection: 'column-reverse',
              justifyContent: 'flex-start',
              width: Math.max(14, Math.min(24, 600 / grouped.length)),
              flexShrink: 0,
              height: CHART_H,
              position: 'relative',
              cursor: 'default',
            }}
            title={`${bucketLabel(g.ts, granularity)}: ${fmtBytes(g.total)} total`}
          >
            {CATS.map((c) => {
              const v = g.cats[c.cat] ?? 0;
              if (v === 0) return null;
              const h = Math.max(2, (v / max) * (CHART_H - 8));
              return (
                <div
                  key={c.cat}
                  style={{
                    height: h,
                    background: `var(${c.colorVar})`,
                    borderRadius: 3,
                    marginTop: 2, // the 2px surface gap between stacked segments
                  }}
                />
              );
            })}
            {hover === i && (
              <div
                className="tt-pop"
                style={{ width: 190, left: '50%', bottom: CHART_H + 6 }}
                role="tooltip"
              >
                <strong>{bucketLabel(g.ts, granularity)}</strong> — {fmtBytes(g.total)}
                {CATS.map((c) => {
                  const v = g.cats[c.cat] ?? 0;
                  return v > 0 ? (
                    <div key={c.cat}>
                      <span className="key" style={{ background: `var(${c.colorVar})` }} /> {c.label}:{' '}
                      {fmtBytes(v)}
                    </div>
                  ) : null;
                })}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        {grouped.map((g, i) => (
          <span
            key={g.ts}
            className="dim"
            style={{
              width: Math.max(14, Math.min(24, 600 / grouped.length)),
              flexShrink: 0,
              fontSize: 10,
              textAlign: 'center',
              overflow: 'visible',
              whiteSpace: 'nowrap',
              visibility: i % Math.ceil(grouped.length / 12) === 0 ? 'visible' : 'hidden',
            }}
          >
            {bucketLabel(g.ts, granularity)}
          </span>
        ))}
      </div>
      <p className="dim" style={{ marginTop: 8 }}>
        Internet-side measurement data only{' '}
        <Tooltip text="Bytes Trapline itself sent and received to test your connection. Pings to your own router stay inside your home and are excluded, since they never touch your data cap. Speed tests dominate — reduce their frequency with Eco mode if you have a cap." />
      </p>
    </div>
  );
}
