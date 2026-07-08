import { useEffect, useState } from 'react';
import type { UsageSummary } from '../../../shared/types';
import { api, fmtBytes } from '../api/client';
import { StatTile } from '../components/StatTile';
import { Tooltip } from '../components/Tooltip';
import { UsageChart } from '../components/UsagePanel';

type Granularity = 'hour' | 'day' | 'month' | 'year';

const TABS: { g: Granularity; label: string }[] = [
  { g: 'hour', label: 'By hour (48 h)' },
  { g: 'day', label: 'By day' },
  { g: 'month', label: 'By month' },
  { g: 'year', label: 'By year' },
];

export function UsagePage() {
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    void api.usage(granularity).then(setUsage).catch(() => {});
  }, [granularity]);

  const monthStart = new Date();
  const thisMonthFrom = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1).getTime();
  const thisMonth = usage?.buckets
    .filter((b) => !b.isLan && b.bucketStart >= thisMonthFrom)
    .reduce((s, b) => s + b.bytesSent + b.bytesRecv, 0);

  return (
    <div>
      <h1 className="page-title">Data usage</h1>
      <p className="page-sub">
        Monitoring costs data — mostly the speed tests. Here is exactly how much Trapline has used,
        so you can pick the right mode for your data cap.
      </p>

      <div className="section tiles">
        <StatTile
          label="Lifetime"
          value={usage ? fmtBytes(usage.lifetimeBytes) : '…'}
          help="Total internet-side data Trapline has used since it was installed — speed tests, pings, DNS and web checks combined."
        />
        <StatTile
          label="This month"
          value={usage && granularity === 'day' ? fmtBytes(thisMonth ?? 0) : usage ? fmtBytes(thisMonth ?? 0) : '…'}
          help="Data used since the 1st of the current month (the number that matters for a monthly data cap)."
        />
        {usage &&
          (['eco', 'normal', 'full'] as const).map((mode) => (
            <StatTile
              key={mode}
              label={`Projected / month — ${mode === 'full' ? 'Full Capture' : mode[0]!.toUpperCase() + mode.slice(1)}`}
              value={`~${fmtBytes(usage.projections[mode])}`}
              help={
                mode === 'eco'
                  ? 'Estimated monthly usage if you run Eco mode all month, based on its probe schedule and your recent speed-test sizes.'
                  : mode === 'normal'
                    ? 'Estimated monthly usage in Normal mode. Fine for uncapped connections.'
                    : 'Estimated monthly usage if Full Capture ran all month — it is meant for short bursts, not continuous use.'
              }
            />
          ))}
      </div>

      <div className="section card">
        <h3>
          Usage over time
          <Tooltip text="Stacked by measurement type. Speed tests (blue) dominate — everything else is tiny by comparison." />
        </h3>
        <div className="seg" role="group" aria-label="Granularity" style={{ marginBottom: 14 }}>
          {TABS.map((t) => (
            <button
              key={t.g}
              type="button"
              className={granularity === t.g ? 'active' : ''}
              onClick={() => setGranularity(t.g)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {usage && <UsageChart buckets={usage.buckets} granularity={granularity} />}
      </div>
    </div>
  );
}
