/**
 * Report generation: summary statistics over a date range, daily
 * breakdowns, and CSV/JSON export payloads. The numbers here are the
 * evidence — computation is deliberately simple and documented in the
 * methodology appendix (reportHtml.ts and README.md).
 */
import type {
  MonitorEvent,
  PingRollup,
  SpeedTestResult,
  SummaryStats,
  Target,
} from '../../../shared/types.js';
import type { Repo } from '../db/repo.js';
import { mosFromMetrics } from '../util/mos.js';
import { jitter as jitterOf, percentile } from '../util/stats.js';
import { DAY, HOUR, isoLocal, isoUtc } from '../util/time.js';

/** Overlap of [aFrom,aTo] with [bFrom,bTo], in ms. */
function overlap(aFrom: number, aTo: number, bFrom: number, bTo: number): number {
  return Math.max(0, Math.min(aTo, bTo) - Math.max(aFrom, bFrom));
}

function wanTargetIds(repo: Repo): Set<number> {
  return new Set(
    repo
      .listTargets()
      .filter((t) => !t.isLan && t.kind !== 'custom')
      .map((t) => t.id),
  );
}

interface LatencyAgg {
  lossPct: number;
  latencyP50: number | null;
  latencyP95: number | null;
  jitterAvg: number | null;
  sent: number;
}

/**
 * Latency/loss aggregates for WAN targets over [from, to]: hourly rollups
 * where they exist, raw samples for the most recent (not yet rolled up)
 * portion.
 */
function latencyAggregates(repo: Repo, from: number, to: number): LatencyAgg {
  const wanIds = wanTargetIds(repo);
  const rollups = repo.getPingRollups(from, to).filter((r) => wanIds.has(r.targetId));
  const lastRollupEnd = rollups.length
    ? Math.max(...rollups.map((r) => r.hourStart)) + HOUR
    : from;

  let sent = 0;
  let lost = 0;
  let p50WeightedSum = 0;
  let p95WeightedSum = 0;
  let jitterWeightedSum = 0;
  let received = 0;
  const addRollup = (r: PingRollup): void => {
    sent += r.sent;
    lost += r.lost;
    const ok = r.sent - r.lost;
    if (ok > 0 && r.rttP50 !== null) {
      p50WeightedSum += r.rttP50 * ok;
      p95WeightedSum += (r.rttP95 ?? r.rttP50) * ok;
      jitterWeightedSum += (r.jitterAvg ?? 0) * ok;
      received += ok;
    }
  };
  for (const r of rollups) addRollup(r);

  // Raw tail not yet covered by rollups.
  if (lastRollupEnd < to) {
    const raw = repo
      .getPingSamples(Math.max(from, lastRollupEnd), to)
      .filter((s) => wanIds.has(s.targetId));
    const rtts = raw.filter((s) => s.rttMs !== null).map((s) => s.rttMs!);
    sent += raw.length;
    lost += raw.filter((s) => s.rttMs === null).length;
    if (rtts.length > 0) {
      const sorted = [...rtts].sort((a, b) => a - b);
      p50WeightedSum += (percentile(sorted, 0.5) ?? 0) * rtts.length;
      p95WeightedSum += (percentile(sorted, 0.95) ?? 0) * rtts.length;
      jitterWeightedSum += (jitterOf(rtts) ?? 0) * rtts.length;
      received += rtts.length;
    }
  }

  return {
    lossPct: sent > 0 ? (lost / sent) * 100 : 0,
    latencyP50: received > 0 ? p50WeightedSum / received : null,
    latencyP95: received > 0 ? p95WeightedSum / received : null,
    jitterAvg: received > 0 ? jitterWeightedSum / received : null,
    sent,
  };
}

export function computeSummary(repo: Repo, from: number, to: number): SummaryStats {
  const events = repo.getEvents(from, to);
  const now = Date.now();
  const effectiveTo = Math.min(to, now);
  const rangeMs = Math.max(1, effectiveTo - from);

  const gapMs = events
    .filter((e) => e.kind === 'monitor_gap')
    .reduce((s, e) => s + overlap(from, effectiveTo, e.startedAt, e.endedAt ?? now), 0);
  const monitoredMs = Math.max(0, rangeMs - gapMs);

  const outages = events.filter((e) => e.kind === 'outage');
  const outageMs = outages.reduce(
    (s, e) => s + overlap(from, effectiveTo, e.startedAt, e.endedAt ?? now),
    0,
  );

  const agg = latencyAggregates(repo, from, effectiveTo);
  const speed = repo.getSpeedTests(from, effectiveTo).filter((t) => t.error === null);
  const avg = (xs: number[]): number | null =>
    xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;

  return {
    from,
    to: effectiveTo,
    coveragePct: (monitoredMs / rangeMs) * 100,
    uptimePct: monitoredMs > 0 ? ((monitoredMs - outageMs) / monitoredMs) * 100 : 0,
    outageCount: outages.length,
    outageTotalMs: outageMs,
    lossPct: agg.lossPct,
    latencyP50: agg.latencyP50,
    latencyP95: agg.latencyP95,
    jitterAvg: agg.jitterAvg,
    mos: mosFromMetrics(agg.latencyP50, agg.jitterAvg, agg.lossPct / 100),
    speedTests: speed.length,
    avgDownBps: avg(speed.map((t) => t.downBps).filter((v): v is number => v !== null)),
    avgUpBps: avg(speed.map((t) => t.upBps).filter((v): v is number => v !== null)),
    events,
  };
}

export interface DailySummary {
  dayStart: number;
  date: string;
  uptimePct: number;
  coveragePct: number;
  outageCount: number;
  outageMs: number;
  lossPct: number;
  latencyP50: number | null;
  avgDownBps: number | null;
  avgUpBps: number | null;
}

export function computeDailySummaries(repo: Repo, from: number, to: number): DailySummary[] {
  const out: DailySummary[] = [];
  // Local-midnight day boundaries so days match the user's calendar.
  let cursor = new Date(from);
  cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
  while (cursor.getTime() < to) {
    const dayStart = cursor.getTime();
    const next = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    const dayEnd = Math.min(next.getTime(), to);
    if (dayEnd > from) {
      const s = computeSummary(repo, Math.max(dayStart, from), dayEnd);
      out.push({
        dayStart,
        date: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(
          cursor.getDate(),
        ).padStart(2, '0')}`,
        uptimePct: s.uptimePct,
        coveragePct: s.coveragePct,
        outageCount: s.outageCount,
        outageMs: s.outageTotalMs,
        lossPct: s.lossPct,
        latencyP50: s.latencyP50,
        avgDownBps: s.avgDownBps,
        avgUpBps: s.avgUpBps,
      });
    }
    cursor = next;
  }
  return out;
}

export interface HourlyLatency {
  hourStart: number;
  p50: number | null;
  p95: number | null;
  lossPct: number;
}

/** Per-hour latency/loss across all WAN detection targets (sample-weighted). */
export function hourlyLatencySeries(repo: Repo, from: number, to: number): HourlyLatency[] {
  const wanIds = wanTargetIds(repo);
  const rollups = repo.getPingRollups(from, to).filter((r) => wanIds.has(r.targetId));
  const byHour = new Map<number, PingRollup[]>();
  for (const r of rollups) {
    const list = byHour.get(r.hourStart) ?? [];
    list.push(r);
    byHour.set(r.hourStart, list);
  }
  const out: HourlyLatency[] = [];
  for (const [hourStart, list] of [...byHour.entries()].sort((a, b) => a[0] - b[0])) {
    let sent = 0;
    let lost = 0;
    let ok = 0;
    let p50Sum = 0;
    let p95Sum = 0;
    for (const r of list) {
      sent += r.sent;
      lost += r.lost;
      const received = r.sent - r.lost;
      if (received > 0 && r.rttP50 !== null) {
        p50Sum += r.rttP50 * received;
        p95Sum += (r.rttP95 ?? r.rttP50) * received;
        ok += received;
      }
    }
    out.push({
      hourStart,
      p50: ok > 0 ? p50Sum / ok : null,
      p95: ok > 0 ? p95Sum / ok : null,
      lossPct: sent > 0 ? (lost / sent) * 100 : 0,
    });
  }
  return out;
}

export interface ReportPayload {
  generatedAt: number;
  generatedAtIso: string;
  range: { from: number; to: number; fromIso: string; toIso: string };
  isp: string;
  plan: { downMbps: number | null; upMbps: number | null };
  summary: SummaryStats;
  daily: DailySummary[];
  hourlyLatency: HourlyLatency[];
  outages: (MonitorEvent & { evidence: unknown[] })[];
  speedTests: SpeedTestResult[];
  targets: Target[];
}

export function buildReportPayload(repo: Repo, from: number, to: number): ReportPayload {
  const settings = repo.getSettings();
  const summary = computeSummary(repo, from, to);
  const outages = summary.events
    .filter((e) => e.kind === 'outage')
    .map((e) => ({ ...e, evidence: repo.getEvidence(e.id).map((ev) => ev.content) }));
  return {
    generatedAt: Date.now(),
    generatedAtIso: isoUtc(Date.now()),
    range: { from, to, fromIso: isoUtc(from), toIso: isoUtc(to) },
    isp: settings.plan.ispName,
    plan: { downMbps: settings.plan.downMbps, upMbps: settings.plan.upMbps },
    summary,
    daily: computeDailySummaries(repo, from, to),
    hourlyLatency: hourlyLatencySeries(repo, from, to),
    outages,
    speedTests: repo.getSpeedTests(from, to),
    targets: repo.listTargets(),
  };
}

// ------------------------------------------------------------------- CSV

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvSection(title: string, header: string[], rows: unknown[][]): string {
  return (
    `# ${title}\n` +
    header.join(',') +
    '\n' +
    rows.map((r) => r.map(csvEscape).join(',')).join('\n') +
    '\n'
  );
}

export function buildCsv(payload: ReportPayload): string {
  const events = csvSection(
    'Events (all detected problems in range)',
    [
      'started_utc',
      'started_local',
      'ended_utc',
      'duration_seconds',
      'kind',
      'severity',
      'fault_classification',
      'summary',
    ],
    payload.summary.events.map((e) => [
      isoUtc(e.startedAt),
      isoLocal(e.startedAt),
      e.endedAt !== null ? isoUtc(e.endedAt) : 'ongoing',
      e.endedAt !== null ? Math.round((e.endedAt - e.startedAt) / 1000) : '',
      e.kind,
      e.severity,
      e.classification,
      e.summary,
    ]),
  );

  const daily = csvSection(
    'Daily summaries',
    [
      'date',
      'uptime_pct',
      'coverage_pct',
      'outage_count',
      'outage_seconds',
      'packet_loss_pct',
      'latency_p50_ms',
      'avg_down_mbps',
      'avg_up_mbps',
    ],
    payload.daily.map((d) => [
      d.date,
      d.uptimePct.toFixed(3),
      d.coveragePct.toFixed(1),
      d.outageCount,
      Math.round(d.outageMs / 1000),
      d.lossPct.toFixed(3),
      d.latencyP50 !== null ? d.latencyP50.toFixed(1) : '',
      d.avgDownBps !== null ? (d.avgDownBps / 1e6).toFixed(2) : '',
      d.avgUpBps !== null ? (d.avgUpBps / 1e6).toFixed(2) : '',
    ]),
  );

  const speed = csvSection(
    'Speed tests',
    [
      'time_utc',
      'time_local',
      'trigger',
      'down_mbps',
      'up_mbps',
      'idle_latency_ms',
      'loaded_latency_ms',
      'bufferbloat_grade',
      'error',
    ],
    payload.speedTests.map((t) => [
      isoUtc(t.ts),
      isoLocal(t.ts),
      t.trigger,
      t.downBps !== null ? (t.downBps / 1e6).toFixed(2) : '',
      t.upBps !== null ? (t.upBps / 1e6).toFixed(2) : '',
      t.idleLatencyMs !== null ? t.idleLatencyMs.toFixed(1) : '',
      Math.max(t.loadedDownMs ?? 0, t.loadedUpMs ?? 0) || '',
      t.bufferbloatGrade ?? '',
      t.error ?? '',
    ]),
  );

  return `# Trapline ISP quality report\n# Range: ${payload.range.fromIso} to ${payload.range.toIso}\n# Generated: ${payload.generatedAtIso}\n\n${events}\n${daily}\n${speed}`;
}

export { DAY };
