/**
 * Self-contained, printable HTML evidence report. No external assets, no
 * JavaScript — inline CSS and server-rendered inline SVG charts only, so the
 * file can be attached to an email or opened years later and still render.
 *
 * Charts follow the dataviz method: thin marks, hairline solid gridlines,
 * one hue for magnitude, categorical hues only where series identity
 * matters, values labeled selectively, and a data table twin for
 * everything (the outage/speed tables and daily summary table).
 */
import { formatDuration, isoLocal, isoUtc } from '../util/time.js';
import type { HourlyLatency, ReportPayload } from './reports.js';

// Light palette (reports are print-first documents).
const C = {
  surface: '#fcfcfb',
  page: '#f9f9f7',
  ink: '#0b0b0b',
  secondary: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  baseline: '#c3c2b7',
  blue: '#2a78d6', // series 1
  aqua: '#1baf7a', // series 2
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};

function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ------------------------------------------------------------ SVG helpers

const W = 860;
const H = 240;
const PAD = { top: 16, right: 16, bottom: 34, left: 52 };

interface Scale {
  (v: number): number;
}

function linScale(d0: number, d1: number, r0: number, r1: number): Scale {
  const dd = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / dd) * (r1 - r0);
}

/** Clean tick values for a 0-based magnitude axis. */
function ticks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => max / s <= count) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max * 1.0001; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

function timeLabel(ts: number, rangeMs: number): string {
  const d = new Date(ts);
  if (rangeMs <= 3 * 24 * 3600 * 1000) {
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:00`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function chartFrame(inner: string, yTicks: number[], yScale: Scale, yUnit: string, xLabels: { x: number; text: string }[]): string {
  const grid = yTicks
    .map(
      (t) =>
        `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${yScale(t)}" y2="${yScale(t)}" stroke="${C.grid}" stroke-width="1"/>` +
        `<text x="${PAD.left - 8}" y="${yScale(t) + 4}" text-anchor="end" fill="${C.muted}" font-size="11">${t}${yUnit}</text>`,
    )
    .join('');
  const xAxis = xLabels
    .map(
      (l) =>
        `<text x="${l.x}" y="${H - 10}" text-anchor="middle" fill="${C.muted}" font-size="11">${esc(l.text)}</text>`,
    )
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" xmlns="http://www.w3.org/2000/svg" style="background:${C.surface}">
    ${grid}
    <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${yScale(0)}" y2="${yScale(0)}" stroke="${C.baseline}" stroke-width="1"/>
    ${inner}
    ${xAxis}
  </svg>`;
}

/** Evenly-spaced x labels (max ~8) from a time-ordered series. */
function xLabelsFor(times: number[], xScale: Scale, rangeMs: number): { x: number; text: string }[] {
  if (times.length === 0) return [];
  const step = Math.max(1, Math.ceil(times.length / 7));
  const out: { x: number; text: string }[] = [];
  for (let i = 0; i < times.length; i += step) {
    out.push({ x: xScale(times[i]!), text: timeLabel(times[i]!, rangeMs) });
  }
  return out;
}

// ------------------------------------------------------------- the charts

/** Hourly latency: p50 line (blue, 2px) with a p50→p95 wash band. */
function latencyChart(series: HourlyLatency[], from: number, to: number): string {
  const pts = series.filter((h) => h.p50 !== null);
  if (pts.length < 2) return `<p class="nodata">Not enough hourly data yet for a latency chart.</p>`;
  const maxY = Math.max(...pts.map((h) => h.p95 ?? h.p50!)) * 1.15;
  const x = linScale(from, to, PAD.left, W - PAD.right);
  const y = linScale(0, maxY, H - PAD.bottom, PAD.top);
  const yT = ticks(maxY);

  // Build segments, breaking the line at gaps (missing hours).
  let line = '';
  let band = '';
  let seg: HourlyLatency[] = [];
  const flush = (): void => {
    if (seg.length >= 2) {
      line += `<polyline fill="none" stroke="${C.blue}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${seg
        .map((h) => `${x(h.hourStart).toFixed(1)},${y(h.p50!).toFixed(1)}`)
        .join(' ')}"/>`;
      const up = seg.map((h) => `${x(h.hourStart).toFixed(1)},${y(h.p95 ?? h.p50!).toFixed(1)}`);
      const down = [...seg].reverse().map((h) => `${x(h.hourStart).toFixed(1)},${y(h.p50!).toFixed(1)}`);
      band += `<polygon fill="${C.blue}" opacity="0.10" points="${[...up, ...down].join(' ')}"/>`;
    }
    seg = [];
  };
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[i - 1];
    if (prev && pts[i]!.hourStart - prev.hourStart > 2 * 3600 * 1000) flush();
    seg.push(pts[i]!);
  }
  flush();

  const last = pts[pts.length - 1]!;
  const endLabel = `<circle cx="${x(last.hourStart)}" cy="${y(last.p50!)}" r="4" fill="${C.blue}" stroke="${C.surface}" stroke-width="2"/>
    <text x="${Math.min(x(last.hourStart) + 8, W - 60)}" y="${y(last.p50!) + 4}" fill="${C.secondary}" font-size="11">${last.p50!.toFixed(0)} ms</text>`;

  return chartFrame(band + line + endLabel, yT, y, '', xLabelsFor(pts.map((p) => p.hourStart), x, to - from)) +
    `<p class="chart-note">Median (p50) hourly latency; the shaded band extends to the 95th percentile — a wide band means an unstable connection.</p>`;
}

/** Daily downtime minutes: single-series columns, zero baseline (honest magnitude). */
function downtimeChart(payload: ReportPayload): string {
  const days = payload.daily;
  if (days.length === 0) return '';
  const maxMin = Math.max(1, ...days.map((d) => d.outageMs / 60000)) * 1.15;
  const x = linScale(0, days.length, PAD.left, W - PAD.right);
  const y = linScale(0, maxMin, H - PAD.bottom, PAD.top);
  const yT = ticks(maxMin);
  const slot = (W - PAD.left - PAD.right) / days.length;
  const barW = Math.min(24, Math.max(3, slot - 2));

  let worst = 0;
  days.forEach((d, i) => {
    if (d.outageMs > days[worst]!.outageMs) worst = i;
  });

  const bars = days
    .map((d, i) => {
      const v = d.outageMs / 60000;
      const bx = x(i) + (slot - barW) / 2;
      const by = y(v);
      const h = Math.max(v > 0 ? 2 : 0, y(0) - by);
      const label =
        i === worst && v > 0
          ? `<text x="${bx + barW / 2}" y="${by - 6}" text-anchor="middle" fill="${C.secondary}" font-size="11">${v.toFixed(0)} min</text>`
          : '';
      return `<rect x="${bx.toFixed(1)}" y="${(y(0) - h).toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" rx="2" fill="${C.blue}"/>${label}`;
    })
    .join('');

  const xLabels = days
    .filter((_, i) => i % Math.max(1, Math.ceil(days.length / 7)) === 0)
    .map((d) => ({
      x: x(days.indexOf(d)) + slot / 2,
      text: d.date.slice(5),
    }));

  return chartFrame(bars, yT, y, '', xLabels) +
    `<p class="chart-note">Total minutes of full outage per day, from continuous probing. The worst day is labeled.</p>`;
}

/** Speed tests: down (blue) and up (aqua) lines + dashed plan thresholds. */
function speedChart(payload: ReportPayload, from: number, to: number): string {
  const tests = payload.speedTests.filter((t) => t.error === null && t.downBps !== null);
  if (tests.length < 2) return `<p class="nodata">Not enough speed tests in this range for a chart.</p>`;
  const planDown = payload.plan.downMbps;
  const planUp = payload.plan.upMbps;
  const maxY =
    Math.max(
      ...tests.map((t) => (t.downBps ?? 0) / 1e6),
      ...tests.map((t) => (t.upBps ?? 0) / 1e6),
      planDown ?? 0,
      planUp ?? 0,
    ) * 1.15;
  const x = linScale(from, to, PAD.left, W - PAD.right);
  const y = linScale(0, maxY, H - PAD.bottom, PAD.top);
  const yT = ticks(maxY);

  const lineOf = (get: (t: (typeof tests)[number]) => number | null, color: string): string => {
    const pts = tests.filter((t) => get(t) !== null);
    const poly = `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" points="${pts
      .map((t) => `${x(t.ts).toFixed(1)},${y(get(t)! / 1e6).toFixed(1)}`)
      .join(' ')}"/>`;
    const dots = pts
      .map(
        (t) =>
          `<circle cx="${x(t.ts).toFixed(1)}" cy="${y(get(t)! / 1e6).toFixed(1)}" r="4" fill="${color}" stroke="${C.surface}" stroke-width="2"/>`,
      )
      .join('');
    return poly + dots;
  };

  const planLine = (mbps: number | null, label: string): string =>
    mbps === null
      ? ''
      : `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(mbps)}" y2="${y(mbps)}" stroke="${C.muted}" stroke-width="1.5" stroke-dasharray="6 4"/>
         <text x="${W - PAD.right}" y="${y(mbps) - 5}" text-anchor="end" fill="${C.muted}" font-size="11">${esc(label)} (${mbps} Mbps)</text>`;

  const inner =
    planLine(planDown, 'advertised download') +
    planLine(planUp, 'advertised upload') +
    lineOf((t) => t.downBps, C.blue) +
    lineOf((t) => t.upBps, C.aqua);

  const legend = `<div class="legend">
    <span><i style="background:${C.blue}"></i>Download</span>
    <span><i style="background:${C.aqua}"></i>Upload</span>
    ${planDown !== null ? `<span><i class="dash"></i>Advertised plan</span>` : ''}
  </div>`;

  return legend + chartFrame(inner, yT, y, '', xLabelsFor(tests.map((t) => t.ts), x, to - from)) +
    `<p class="chart-note">Measured throughput in Mbps per test. Dashed lines mark what the plan advertises.</p>`;
}

// ---------------------------------------------------------------- sections

function severityBadge(sev: string): string {
  const color =
    sev === 'critical' ? C.critical : sev === 'major' ? C.serious : sev === 'minor' ? C.warning : C.muted;
  return `<span class="badge" style="border-color:${color};color:${color}">${esc(sev)}</span>`;
}

function classificationText(c: string): string {
  switch (c) {
    case 'isp':
      return 'ISP network (router reachable, ISP unreachable)';
    case 'lan':
      return 'Home network (router itself unreachable)';
    case 'upstream':
      return 'Beyond ISP first hop (upstream/internet)';
    default:
      return 'Undetermined';
  }
}

function outageTable(payload: ReportPayload): string {
  const outages = payload.summary.events.filter((e) => e.kind === 'outage');
  if (outages.length === 0) return `<p class="nodata">No full outages recorded in this range.</p>`;
  const rows = outages
    .map((e) => {
      const dur = e.endedAt !== null ? formatDuration(e.endedAt - e.startedAt) : 'ongoing';
      return `<tr>
        <td>${esc(isoUtc(e.startedAt))}<br><span class="dim">${esc(isoLocal(e.startedAt))}</span></td>
        <td>${e.endedAt !== null ? `${esc(isoUtc(e.endedAt))}<br><span class="dim">${esc(isoLocal(e.endedAt))}</span>` : 'ongoing'}</td>
        <td class="num">${esc(dur)}</td>
        <td>${severityBadge(e.severity)}</td>
        <td>${esc(classificationText(e.classification))}</td>
      </tr>`;
    })
    .join('');
  return `<table>
    <thead><tr><th>Started (UTC / local)</th><th>Ended (UTC / local)</th><th>Duration</th><th>Severity</th><th>Fault location</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function dailyTable(payload: ReportPayload): string {
  const rows = payload.daily
    .map(
      (d) => `<tr>
      <td>${esc(d.date)}</td>
      <td class="num">${d.uptimePct.toFixed(3)}%</td>
      <td class="num">${d.outageCount}</td>
      <td class="num">${d.outageMs > 0 ? formatDuration(d.outageMs) : '—'}</td>
      <td class="num">${d.lossPct.toFixed(2)}%</td>
      <td class="num">${d.latencyP50 !== null ? `${d.latencyP50.toFixed(1)} ms` : '—'}</td>
      <td class="num">${d.avgDownBps !== null ? `${(d.avgDownBps / 1e6).toFixed(1)}` : '—'}</td>
      <td class="num">${d.avgUpBps !== null ? `${(d.avgUpBps / 1e6).toFixed(1)}` : '—'}</td>
      <td class="num">${d.coveragePct.toFixed(1)}%</td>
    </tr>`,
    )
    .join('');
  return `<table>
    <thead><tr><th>Date</th><th>Uptime</th><th>Outages</th><th>Downtime</th><th>Packet loss</th><th>Latency p50</th><th>Avg ↓ Mbps</th><th>Avg ↑ Mbps</th><th>Coverage</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function methodology(payload: ReportPayload): string {
  const targets = payload.targets
    .map((t) => `<li><strong>${esc(t.label)}</strong> — <code>${esc(t.host)}</code> (${esc(t.kind)})</li>`)
    .join('');
  return `
  <h2>Appendix — Methodology</h2>
  <p>This report was generated automatically by <strong>Trapline</strong>, an open-source ISP
  service-quality monitor running continuously on a computer inside the subscriber's home.
  All timestamps are recorded in UTC (local time shown alongside). Raw measurement data is
  retained and available on request.</p>

  <h3>Probe targets</h3>
  <ul>${targets}</ul>

  <h3>Measurements</h3>
  <ul>
    <li><strong>Reachability (ping):</strong> ICMP echo requests are sent continuously to each
      target (interval 1–30&nbsp;s depending on monitoring mode) using the system
      <code>ping</code> utility with a 3&nbsp;s reply timeout. Every probe is recorded
      individually with its round-trip time, or as lost.</li>
    <li><strong>DNS health:</strong> the machine's configured resolver is timed resolving a
      rotating set of common hostnames (2&nbsp;s timeout).</li>
    <li><strong>HTTP reachability:</strong> small requests to well-known always-on endpoints
      (Google generate_204, Cloudflare trace), recording time-to-first-byte.</li>
    <li><strong>Throughput:</strong> parallel HTTP transfers against Cloudflare's public speed
      endpoints (<code>speed.cloudflare.com</code>). Download uses 5 parallel streams and
      excludes the first 2&nbsp;s (TCP ramp) from the measurement window; upload uses 3 streams
      excluding the first 1&nbsp;s. Latency-under-load is sampled every 500&nbsp;ms during the
      transfers; the difference vs idle latency is graded A+ (&lt;15&nbsp;ms extra) through
      F (&ge;300&nbsp;ms extra) — "bufferbloat".</li>
    <li><strong>Route evidence:</strong> when an event opens, an <code>mtr</code> trace
      (per-hop loss/latency) is captured and attached to the event.</li>
  </ul>

  <h3>Event detection rules</h3>
  <ul>
    <li><strong>Outage:</strong> opens when 3 consecutive probes are lost on <em>every</em>
      internet-side target simultaneously; the start time is backdated to the first lost probe.
      Closes after 3 consecutive replies on at least two targets; the end time is the first
      reply of that run. Severity: minor &lt;60&nbsp;s, major &lt;10&nbsp;min, critical &ge;10&nbsp;min.</li>
    <li><strong>Fault classification:</strong> if the home router (gateway) was also unreachable,
      the event is classed as a home-network problem — <em>these events are excluded from claims
      against the ISP</em>. If the gateway stayed reachable while the ISP's first hop was not,
      the fault lies in the ISP's network. This distinction is verified on every event.</li>
    <li><strong>Packet loss:</strong> &ge;5% loss over the trailing 60 probes on &ge;2 targets.</li>
    <li><strong>Latency spike:</strong> the 60&nbsp;s rolling median exceeds max(2× the 1-hour
      baseline, baseline+30&nbsp;ms) for 30&nbsp;s on &ge;2 targets.</li>
    <li><strong>DNS failure:</strong> two consecutive failed (or &gt;2&nbsp;s) resolutions.</li>
    <li><strong>Speed degradation:</strong> a test measuring below ${Math.round(
      100 * 0.5,
    )}% of the advertised plan (threshold configurable).</li>
  </ul>

  <h3>Statistics</h3>
  <ul>
    <li><strong>Uptime %</strong> = (monitored&nbsp;time − outage&nbsp;time) / monitored&nbsp;time.
      Periods when the monitor itself was not running are <em>excluded</em> from the denominator
      and reported separately as coverage (${payload.summary.coveragePct.toFixed(1)}% for this
      range) — downtime is never inferred from monitoring gaps.</li>
    <li><strong>Quality score (MOS)</strong> uses the simplified ITU-T G.107 E-model:
      R = 93.2 − I<sub>d</sub> − I<sub>e</sub>, where I<sub>d</sub> = 0.024·d + 0.11·(d−177.3)·H(d−177.3)
      with d = p50&nbsp;latency/2 + jitter/2, and I<sub>e</sub> = 30·ln(1 + 15·loss).
      MOS = 1 + 0.035·R + 7×10<sup>−6</sup>·R·(R−60)·(100−R), on a 1–5 scale where
      &ge;4.0 is good and &le;3.0 makes real-time applications (calls, gaming) frustrating.</li>
    <li><strong>Latency percentiles</strong> are computed from individual probe RTTs,
      aggregated hourly, weighted by sample count.</li>
  </ul>

  <p class="dim">Trapline is open source (MIT license); the exact detection thresholds and
  measurement code in effect for this report can be audited in the source repository.</p>`;
}

// ------------------------------------------------------------------ page

export function renderReportHtml(payload: ReportPayload): string {
  const s = payload.summary;
  const range = payload.range;
  const rangeDays = Math.max(1, Math.round((range.to - range.from) / 86_400_000));
  const stateColor = s.uptimePct >= 99.9 ? C.good : s.uptimePct >= 99 ? C.warning : C.critical;

  const tiles: { label: string; value: string; note?: string }[] = [
    {
      label: 'Outages',
      value: String(s.outageCount),
      note: s.outageTotalMs > 0 ? `${formatDuration(s.outageTotalMs)} total downtime` : 'no full outages',
    },
    { label: 'Packet loss', value: `${s.lossPct.toFixed(2)}%`, note: 'share of probes lost' },
    {
      label: 'Latency (median)',
      value: s.latencyP50 !== null ? `${s.latencyP50.toFixed(0)} ms` : '—',
      note: s.latencyP95 !== null ? `p95: ${s.latencyP95.toFixed(0)} ms` : undefined,
    },
    {
      label: 'Quality score',
      value: s.mos !== null ? `${s.mos.toFixed(2)} / 5` : '—',
      note: 'ITU-T E-model MOS',
    },
    {
      label: 'Avg download',
      value: s.avgDownBps !== null ? `${(s.avgDownBps / 1e6).toFixed(1)} Mbps` : '—',
      note:
        payload.plan.downMbps !== null && s.avgDownBps !== null
          ? `${Math.round((s.avgDownBps / 1e6 / payload.plan.downMbps) * 100)}% of advertised ${payload.plan.downMbps} Mbps`
          : `${s.speedTests} tests in range`,
    },
    {
      label: 'Monitoring coverage',
      value: `${s.coveragePct.toFixed(1)}%`,
      note: 'of the range actively measured',
    },
  ];

  const tileHtml = tiles
    .map(
      (t) => `<div class="tile">
      <div class="tile-label">${esc(t.label)}</div>
      <div class="tile-value">${esc(t.value)}</div>
      ${t.note ? `<div class="tile-note">${esc(t.note)}</div>` : ''}
    </div>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Internet service quality report — ${esc(payload.isp)} — ${esc(range.fromIso.slice(0, 10))} to ${esc(range.toIso.slice(0, 10))}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: ${C.page}; color: ${C.ink};
    line-height: 1.55; padding: 32px 16px;
  }
  main { max-width: 920px; margin: 0 auto; background: ${C.surface};
    border: 1px solid rgba(11,11,11,0.10); border-radius: 12px; padding: 40px 44px; }
  h1 { font-size: 26px; letter-spacing: -0.01em; }
  h2 { font-size: 19px; margin: 40px 0 12px; padding-top: 20px; border-top: 1px solid ${C.grid}; }
  h3 { font-size: 15px; margin: 20px 0 8px; }
  p, li { font-size: 14px; color: ${C.ink}; }
  .sub { color: ${C.secondary}; font-size: 14px; margin-top: 4px; }
  .dim { color: ${C.muted}; font-size: 12px; }
  .hero { display: flex; align-items: baseline; gap: 16px; margin: 28px 0 8px; flex-wrap: wrap; }
  .hero-num { font-size: 56px; font-weight: 600; color: ${stateColor}; letter-spacing: -0.02em; }
  .hero-label { font-size: 15px; color: ${C.secondary}; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 20px 0 8px; }
  .tile { border: 1px solid ${C.grid}; border-radius: 10px; padding: 12px 14px; background: ${C.surface}; }
  .tile-label { font-size: 12px; color: ${C.secondary}; }
  .tile-value { font-size: 22px; font-weight: 600; margin-top: 2px; }
  .tile-note { font-size: 11px; color: ${C.muted}; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 12px 0; }
  th { text-align: left; color: ${C.secondary}; font-weight: 600; border-bottom: 1px solid ${C.baseline}; padding: 6px 8px; }
  td { border-bottom: 1px solid ${C.grid}; padding: 6px 8px; vertical-align: top; }
  td.num { font-variant-numeric: tabular-nums; text-align: right; }
  .badge { border: 1px solid; border-radius: 99px; font-size: 11px; padding: 1px 8px; }
  .legend { display: flex; gap: 18px; font-size: 12px; color: ${C.secondary}; margin: 8px 0 4px; }
  .legend i { display: inline-block; width: 14px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 6px; }
  .legend i.dash { background: none; border-top: 2px dashed ${C.muted}; height: 0; }
  .chart-note { font-size: 12px; color: ${C.muted}; margin: 6px 0 0; }
  .nodata { color: ${C.muted}; font-size: 13px; font-style: italic; }
  code { background: ${C.page}; border: 1px solid ${C.grid}; border-radius: 4px; padding: 0 4px; font-size: 12px; }
  footer { margin-top: 36px; padding-top: 16px; border-top: 1px solid ${C.grid}; font-size: 12px; color: ${C.muted}; }
  @media print {
    body { background: white; padding: 0; }
    main { border: none; padding: 0; max-width: none; }
    h2 { break-after: avoid; }
    table, svg, .tiles { break-inside: avoid; }
  }
</style>
</head>
<body>
<main>
  <header>
    <h1>Internet service quality report</h1>
    <p class="sub">
      ISP: <strong>${esc(payload.isp)}</strong>
      ${payload.plan.downMbps !== null ? ` · Plan: ${payload.plan.downMbps}↓ / ${payload.plan.upMbps ?? '?'}↑ Mbps` : ''}
      · Period: <strong>${esc(range.fromIso.slice(0, 10))}</strong> to <strong>${esc(range.toIso.slice(0, 10))}</strong> (${rangeDays} days)
      · Generated ${esc(payload.generatedAtIso)}
    </p>
  </header>

  <div class="hero">
    <span class="hero-num">${s.uptimePct.toFixed(s.uptimePct >= 99.9 ? 3 : 2)}%</span>
    <span class="hero-label">uptime over the reporting period<br>
      <span class="dim">${s.outageCount} outage${s.outageCount === 1 ? '' : 's'}, ${formatDuration(s.outageTotalMs)} of total downtime</span>
    </span>
  </div>

  <div class="tiles">${tileHtml}</div>

  <h2>Outages</h2>
  ${outageTable(payload)}

  <h2>Daily downtime</h2>
  ${downtimeChart(payload)}

  <h2>Latency</h2>
  ${latencyChart(payload.hourlyLatency, range.from, range.to)}

  <h2>Measured speed vs advertised plan</h2>
  ${speedChart(payload, range.from, range.to)}

  <h2>Daily summary</h2>
  ${dailyTable(payload)}

  ${methodology(payload)}

  <footer>
    Generated by Trapline v0.1.0 — continuous ISP quality monitoring. This document is
    self-contained; print to PDF for filing. Raw data exports (CSV/JSON) accompany this report.
  </footer>
</main>
</body>
</html>`;
}
