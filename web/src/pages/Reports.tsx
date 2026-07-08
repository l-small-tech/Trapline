import { useEffect, useState } from 'react';
import type { SummaryStats } from '../../../shared/types';
import { API, api, fmtDuration, fmtMbps } from '../api/client';
import { EventsTimeline } from '../components/EventsTimeline';
import { RangePicker, presetRange, type Range } from '../components/RangePicker';
import { StatTile } from '../components/StatTile';
import { Tooltip } from '../components/Tooltip';

export function Reports() {
  const [range, setRange] = useState<Range>(() => presetRange('Last 7 days', 7));
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    void api
      .summary(range.from, range.to)
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [range]);

  const exportUrl = (format: string): string =>
    `${API}/reports?from=${range.from}&to=${range.to}&format=${format}`;

  return (
    <div>
      <h1 className="page-title">Reports</h1>
      <p className="page-sub">
        Pick a period, review what happened, and export an evidence report to send to your ISP —
        or raw data for your own analysis. The HTML report is self-contained: open it and print to
        PDF.
      </p>

      <RangePicker value={range} onChange={setRange} />

      <div className="btn-row section">
        <a className="btn primary" href={exportUrl('html')} target="_blank" rel="noreferrer">
          📄 Evidence report (HTML)
        </a>
        <a className="btn" href={exportUrl('csv')}>
          ⬇︎ Raw data (CSV)
        </a>
        <a className="btn" href={exportUrl('json')}>
          ⬇︎ Raw data (JSON)
        </a>
        <Tooltip text="The HTML report includes charts, the outage table with exact timestamps, and a methodology appendix explaining how everything was measured — designed to be credible when shown to the ISP. CSV/JSON contain the same numbers for spreadsheets or scripts." />
        {loading && <span className="spin" />}
      </div>

      {summary && (
        <>
          <div className="section tiles">
            <StatTile
              label="Uptime"
              value={`${summary.uptimePct.toFixed(summary.uptimePct >= 99.9 ? 3 : 2)}%`}
              note={`coverage ${summary.coveragePct.toFixed(1)}%`}
              help="Uptime over the selected period. Coverage is how much of the period Trapline was actually running — honest reports state both."
            />
            <StatTile
              label="Outages"
              value={summary.outageCount}
              note={summary.outageTotalMs > 0 ? `${fmtDuration(summary.outageTotalMs)} total` : undefined}
              help="Number of full connection losses, with the total time you had no internet."
            />
            <StatTile
              label="Packet loss"
              value={`${summary.lossPct.toFixed(2)}%`}
              help="Share of all probes that got no reply during the period."
            />
            <StatTile
              label="Latency p50 / p95"
              value={
                summary.latencyP50 != null
                  ? `${summary.latencyP50.toFixed(0)} / ${summary.latencyP95?.toFixed(0) ?? '—'} ms`
                  : '—'
              }
              help="Typical latency and worst-5% latency. A big gap between them means an unstable line."
            />
            <StatTile
              label="Quality score"
              value={summary.mos != null ? `${summary.mos.toFixed(2)} / 5` : '—'}
              help="ITU-T E-model call-quality estimate from latency, jitter and loss. Under 3 = frustrating video calls."
            />
            <StatTile
              label="Avg speed"
              value={`${fmtMbps(summary.avgDownBps)} ↓`}
              note={`${fmtMbps(summary.avgUpBps)} ↑ · ${summary.speedTests} tests`}
              help="Average measured throughput across all speed tests in the period."
            />
          </div>

          <div className="section card">
            <h3>
              All events in this period
              <Tooltip text="Every detected problem, with exact timestamps and fault classification. This same table appears in the exported report." />
            </h3>
            <EventsTimeline events={summary.events} />
          </div>
        </>
      )}
    </div>
  );
}
