import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type uPlot from 'uplot';
import type {
  Mode,
  PingPoint,
  Settings,
  SpeedTestResult,
  SummaryStats,
} from '../../../shared/types';
import { api, fmtDuration } from '../api/client';
import { EventsTimeline } from '../components/EventsTimeline';
import { ModeSwitcher } from '../components/ModeSwitcher';
import { Sparkline } from '../components/Sparkline';
import { SpeedHistory } from '../components/SpeedHistory';
import { StatTile } from '../components/StatTile';
import { StatusHero } from '../components/StatusHero';
import { TimeChart } from '../components/TimeChart';
import { Tooltip } from '../components/Tooltip';
import { useLiveMessage, useStatus } from '../hooks/useLive';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LIVE_WINDOW_MS = 3 * HOUR;

export function Dashboard() {
  const { status } = useStatus();
  const [summaries, setSummaries] = useState<Record<string, SummaryStats>>({});
  const [tests, setTests] = useState<SpeedTestResult[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [projections, setProjections] = useState<Record<Mode, number> | undefined>();
  const [selectedTarget, setSelectedTarget] = useState<number | null>(null);
  const [chartPoints, setChartPoints] = useState<[number, number | null][]>([]);
  // Rolling per-target buffers feeding the sparklines.
  const sparkBuffers = useRef(new Map<number, (number | null)[]>());
  const [sparkTick, setSparkTick] = useState(0);

  // Initial data.
  useEffect(() => {
    const now = Date.now();
    for (const [key, span] of [
      ['24h', DAY],
      ['7d', 7 * DAY],
      ['30d', 30 * DAY],
    ] as const) {
      void api
        .summary(now - span, now)
        .then((s) => setSummaries((prev) => ({ ...prev, [key]: s })))
        .catch(() => {});
    }
    void api.speedTests(now - 30 * DAY, now).then(setTests).catch(() => {});
    void api.settings().then(setSettings).catch(() => {});
    void api
      .usage('day')
      .then((u) => setProjections(u.projections))
      .catch(() => {});
  }, []);

  // Pick the first WAN target once status arrives.
  useEffect(() => {
    if (status && selectedTarget === null) {
      const wan = status.targets.find((t) => !t.target.isLan) ?? status.targets[0];
      if (wan) setSelectedTarget(wan.target.id);
    }
  }, [status, selectedTarget]);

  // Load history for the selected target's chart.
  useEffect(() => {
    if (selectedTarget === null) return;
    const now = Date.now();
    void api
      .pingSamples(now - LIVE_WINDOW_MS, now, 3000)
      .then((groups) => {
        const g = groups.find((x) => x.targetId === selectedTarget);
        setChartPoints(g?.points ?? []);
      })
      .catch(() => {});
  }, [selectedTarget]);

  // Live appends.
  const onSamples = useCallback(
    (data: { ping: PingPoint[] }) => {
      if (data.ping.length === 0) return;
      for (const p of data.ping) {
        const buf = sparkBuffers.current.get(p.targetId) ?? [];
        buf.push(p.rttMs);
        if (buf.length > 60) buf.shift();
        sparkBuffers.current.set(p.targetId, buf);
      }
      setSparkTick((v) => v + 1);
      setChartPoints((prev) => {
        const mine = data.ping.filter((p) => p.targetId === selectedTarget);
        if (mine.length === 0) return prev;
        const cutoff = Date.now() - LIVE_WINDOW_MS;
        const next = [...prev, ...mine.map((p): [number, number | null] => [p.ts, p.rttMs])];
        return next.filter(([ts]) => ts >= cutoff);
      });
    },
    [selectedTarget],
  );
  useLiveMessage('samples', onSamples);

  // Live speed test results append to the history.
  useLiveMessage(
    'speedtest',
    useCallback((data: { result?: SpeedTestResult }) => {
      if (data.result) setTests((prev) => [...prev, data.result!]);
    }, []),
  );

  const chartData = useMemo((): uPlot.AlignedData => {
    const xs = chartPoints.map(([ts]) => ts / 1000);
    const rtts = chartPoints.map(([, v]) => v);
    // Lost probes rendered as markers pinned near the baseline.
    const losses = chartPoints.map(([, v]) => (v === null ? 0 : null));
    return [xs, rtts, losses];
  }, [chartPoints]);

  const s24 = summaries['24h'];

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">
        Trapline checks your connection around the clock and keeps the receipts.
      </p>

      <div className="section">{status && <StatusHero status={status} />}</div>

      <div className="section tiles">
        <StatTile
          label="Uptime (24 h)"
          value={s24 ? `${s24.uptimePct.toFixed(2)}%` : '…'}
          note={s24 && s24.outageCount > 0 ? `${s24.outageCount} outages, ${fmtDuration(s24.outageTotalMs)} down` : 'no outages'}
          help="Percentage of the last 24 hours your connection was actually working, measured by continuous probing. Periods when this computer was off are excluded, not counted against the ISP."
        />
        <StatTile
          label="Uptime (7 d)"
          value={summaries['7d'] ? `${summaries['7d'].uptimePct.toFixed(2)}%` : '…'}
          note={summaries['7d'] ? `${summaries['7d'].outageCount} outages` : undefined}
          help="Uptime over the last week. Residential fiber should comfortably exceed 99.9%."
        />
        <StatTile
          label="Uptime (30 d)"
          value={summaries['30d'] ? `${summaries['30d'].uptimePct.toFixed(2)}%` : '…'}
          note={summaries['30d'] ? `${summaries['30d'].outageCount} outages` : undefined}
          help="Uptime over the last month — the number to quote when talking to your ISP."
        />
        <StatTile
          label="Packet loss (24 h)"
          value={s24 ? `${s24.lossPct.toFixed(2)}%` : '…'}
          help="How many probe packets vanished in the last 24 hours. Anything consistently above 1% causes stutter in calls and games."
        />
        <StatTile
          label="Latency p50 (24 h)"
          value={s24?.latencyP50 != null ? `${s24.latencyP50.toFixed(0)} ms` : '…'}
          note={s24?.latencyP95 != null ? `p95: ${s24.latencyP95.toFixed(0)} ms` : undefined}
          help="Median round-trip time to the internet. p95 is the 'bad moments' number — if it's far above the median, your connection is unstable."
        />
        <StatTile
          label="Quality score (24 h)"
          value={s24?.mos != null ? `${s24.mos.toFixed(2)} / 5` : '…'}
          help="A phone-call quality score (ITU-T MOS) computed from latency, jitter, and loss. Above 4 is good; below 3 means calls sound bad."
        />
      </div>

      <div className="section card">
        <h3>
          Live latency
          <Tooltip text="Round-trip time of each probe, live. Red markers on the baseline are lost probes. Use the buttons to look at a specific target — comparing your router vs the ISP shows where problems live." />
        </h3>
        {status && (
          <div className="btn-row" style={{ marginBottom: 10 }}>
            <div className="seg" role="group" aria-label="Probe target">
              {status.targets.map((t) => (
                <button
                  key={t.target.id}
                  type="button"
                  className={selectedTarget === t.target.id ? 'active' : ''}
                  onClick={() => setSelectedTarget(t.target.id)}
                >
                  {t.target.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <TimeChart
          data={chartData}
          series={[
            { label: 'RTT', colorVar: '--series-1', unit: ' ms' },
            { label: 'Lost', colorVar: '--critical', pointsOnly: true, unit: '' },
          ]}
          yUnit=" ms"
          height={260}
        />
      </div>

      {status && (
        <div className="section grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
          {status.targets.map((t) => (
            <div className="card" key={t.target.id}>
              <div className="tile-label">
                {t.target.label}
                <Tooltip
                  text={
                    t.target.kind === 'gateway'
                      ? 'Your own router. If this stops answering, the problem is inside your home, not the ISP.'
                      : t.target.kind === 'isp_hop'
                        ? "The first machine inside your ISP's network. If your router answers but this doesn't, the ISP is at fault."
                        : 'A rock-solid public server on the wider internet, used as a reference point.'
                  }
                />
              </div>
              <div className="tile-value" style={{ fontSize: 20 }}>
                {t.lastRttMs !== null ? `${t.lastRttMs.toFixed(1)} ms` : (
                  <span style={{ color: 'var(--critical)' }}>no reply</span>
                )}
              </div>
              <div className="tile-note">
                {t.recentLossPct > 0 ? `${t.recentLossPct}% recent loss` : 'no recent loss'}
              </div>
              <div data-tick={sparkTick}>
                <Sparkline points={sparkBuffers.current.get(t.target.id) ?? []} width={200} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section card">
        <h3>
          Speed history (30 days)
          <Tooltip text="Automatic speed tests over the last month, compared with what your plan advertises." />
        </h3>
        <SpeedHistory tests={tests} plan={settings?.plan ?? null} />
      </div>

      <div className="section card">
        <h3>
          Recent events
          <Tooltip text="Everything Trapline detected recently — outages, packet loss, latency spikes. Click Details for the attached evidence." />
        </h3>
        <RecentEvents />
      </div>

      <div className="section">{status && <ModeSwitcher status={status} projections={projections} />}</div>
    </div>
  );
}

function RecentEvents() {
  const [events, setEvents] = useState<Awaited<ReturnType<typeof api.recentEvents>>>([]);
  const refresh = useCallback(() => {
    void api.recentEvents().then(setEvents).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);
  useLiveMessage('event', refresh);
  return <EventsTimeline events={events.slice(0, 12)} />;
}
