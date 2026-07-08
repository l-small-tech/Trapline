import { useMemo } from 'react';
import type uPlot from 'uplot';
import type { PlanSettings, SpeedTestResult } from '../../../shared/types';
import { TimeChart, type ChartSeries } from './TimeChart';
import { Tooltip } from './Tooltip';

/** Download/upload history vs the advertised plan (dashed reference). */
export function SpeedHistory({
  tests,
  plan,
}: {
  tests: SpeedTestResult[];
  plan: PlanSettings | null;
}) {
  const ok = useMemo(() => tests.filter((t) => t.error === null && t.downBps !== null), [tests]);

  const { data, series } = useMemo(() => {
    const xs = ok.map((t) => t.ts / 1000);
    const down = ok.map((t) => (t.downBps === null ? null : t.downBps / 1e6));
    const up = ok.map((t) => (t.upBps === null ? null : t.upBps / 1e6));
    const cols: (number | null)[][] = [down, up];
    const defs: ChartSeries[] = [
      { label: 'Download', colorVar: '--series-1', unit: ' Mbps' },
      { label: 'Upload', colorVar: '--series-2', unit: ' Mbps' },
    ];
    if (plan?.downMbps) {
      cols.push(ok.map(() => plan.downMbps));
      defs.push({ label: 'Plan ↓', colorVar: '--muted', dash: [6, 4], unit: ' Mbps' });
    }
    if (plan?.upMbps) {
      cols.push(ok.map(() => plan.upMbps));
      defs.push({ label: 'Plan ↑', colorVar: '--muted', dash: [2, 4], unit: ' Mbps' });
    }
    return { data: [xs, ...cols] as uPlot.AlignedData, series: defs };
  }, [ok, plan]);

  if (ok.length < 2) {
    return (
      <p className="dim">
        Not enough speed tests yet — they run automatically on a schedule, or start one from the
        Tools page.
      </p>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
        <Tooltip text="Each dot is one automatic or manual speed test, in megabits per second. The dashed lines show what your plan advertises — sustained results far below them are evidence of under-delivery." />
      </div>
      <TimeChart data={data} series={series} yUnit=" Mbps" height={240} />
    </div>
  );
}
