/**
 * REST API. All routes are registered under the /trapline/api prefix.
 * On-demand tool endpoints validate host input and always spawn with
 * argument arrays (never shell strings).
 */
import type { FastifyInstance } from 'fastify';
import { spawn } from 'node:child_process';
import type {
  DnsBenchResult,
  HealthCheckResult,
  Mode,
  Settings,
  UsageSummary,
} from '../../../shared/types.js';
import { EST_BYTES, MODES, VERSION } from '../config.js';
import type { Repo } from '../db/repo.js';
import type { Scheduler } from '../monitor/scheduler.js';
import type { UsageLedger } from '../monitor/usage.js';
import { BENCH_HOSTNAMES, BENCH_RESOLVERS, timedResolve } from '../probes/dns.js';
import { httpCheck } from '../probes/http.js';
import { runMtr } from '../probes/mtr.js';
import { parsePingLine } from '../probes/ping.js';
import type { SpeedTestEngine } from '../speedtest/engine.js';
import { decimateMinMax } from '../util/stats.js';
import { DAY } from '../util/time.js';
import { buildCsv, buildReportPayload, computeSummary } from './reports.js';
import { renderReportHtml } from './reportHtml.js';
import type { SseHub } from './sse.js';

const HOST_RE = /^[a-zA-Z0-9]([a-zA-Z0-9.:-]{0,252}[a-zA-Z0-9])?$/;

function validHost(host: unknown): host is string {
  return typeof host === 'string' && host.length <= 254 && HOST_RE.test(host);
}

function isHttpUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2000) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function numberIn(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

/**
 * Validate a PUT /settings body against the known settings shape.
 * Unknown keys are rejected so typos fail loudly instead of persisting
 * silently; `mode` is accepted but ignored (changes go through POST /mode).
 * Returns the merged settings or an error message.
 */
export function mergeSettings(
  current: Settings,
  body: Record<string, unknown>,
): { next: Settings } | { error: string } {
  const next: Settings = { ...current, plan: { ...current.plan } };
  for (const [key, value] of Object.entries(body)) {
    switch (key) {
      case 'mode':
        break; // scheduler-owned; see POST /mode
      case 'theme':
        if (value !== 'dark' && value !== 'light') return { error: 'theme must be dark or light' };
        next.theme = value;
        break;
      case 'speedtestDownUrl':
        if (!isHttpUrl(value)) return { error: 'speedtestDownUrl must be an http(s) URL' };
        next.speedtestDownUrl = value;
        break;
      case 'speedtestUpUrl':
        if (!isHttpUrl(value)) return { error: 'speedtestUpUrl must be an http(s) URL' };
        next.speedtestUpUrl = value;
        break;
      case 'speedDegradationFraction':
        if (!numberIn(value, 0.1, 1)) return { error: 'speedDegradationFraction must be 0.1–1' };
        next.speedDegradationFraction = value;
        break;
      case 'latencyThresholdMs':
        if (!numberIn(value, 0, 10_000)) return { error: 'latencyThresholdMs must be 0–10000' };
        next.latencyThresholdMs = value;
        break;
      case 'retentionPingDays':
        if (!numberIn(value, 1, 3650)) return { error: 'retentionPingDays must be 1–3650' };
        next.retentionPingDays = value;
        break;
      case 'retentionDnsHttpDays':
        if (!numberIn(value, 1, 3650)) return { error: 'retentionDnsHttpDays must be 1–3650' };
        next.retentionDnsHttpDays = value;
        break;
      case 'plan': {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          return { error: 'plan must be an object' };
        }
        for (const [pk, pv] of Object.entries(value as Record<string, unknown>)) {
          switch (pk) {
            case 'ispName':
              if (typeof pv !== 'string' || pv.length > 200) return { error: 'plan.ispName must be a string of at most 200 characters' };
              next.plan.ispName = pv;
              break;
            case 'currency':
              if (typeof pv !== 'string' || pv.length > 10) return { error: 'plan.currency must be a string of at most 10 characters' };
              next.plan.currency = pv;
              break;
            case 'downMbps':
              if (pv !== null && !numberIn(pv, 0, 1_000_000)) return { error: 'plan.downMbps must be a number or null' };
              next.plan.downMbps = pv;
              break;
            case 'upMbps':
              if (pv !== null && !numberIn(pv, 0, 1_000_000)) return { error: 'plan.upMbps must be a number or null' };
              next.plan.upMbps = pv;
              break;
            case 'pricePerMonth':
              if (pv !== null && !numberIn(pv, 0, 1_000_000)) return { error: 'plan.pricePerMonth must be a number or null' };
              next.plan.pricePerMonth = pv;
              break;
            default:
              return { error: `unknown plan setting: ${pk}` };
          }
        }
        break;
      }
      default:
        return { error: `unknown setting: ${key}` };
    }
  }
  return { next };
}

function rangeParams(q: Record<string, unknown>): { from: number; to: number } {
  const now = Date.now();
  const to = Number(q.to ?? now) || now;
  const from = Number(q.from ?? to - DAY) || to - DAY;
  return { from: Math.min(from, to), to };
}

export interface RouteDeps {
  repo: Repo;
  scheduler: Scheduler;
  speedEngine: SpeedTestEngine;
  usage: UsageLedger;
  hub: SseHub;
}

/** One-shot ping burst for the Tools page (arg-array spawn, no shell). */
async function pingBurst(
  host: string,
  count: number,
): Promise<{ rtts: (number | null)[]; medianRttMs: number | null; lossPct: number }> {
  return new Promise((resolve) => {
    const child = spawn('ping', ['-n', '-O', '-W', '2', '-i', '0.3', '-c', String(count), host], {
      env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const rtts: (number | null)[] = [];
    let buf = '';
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const parsed = parsePingLine(line);
        if (parsed.kind === 'reply') rtts.push(parsed.rttMs);
        else if (parsed.kind === 'timeout' || (parsed.kind === 'error' && parsed.seq !== null)) rtts.push(null);
      }
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), (count * 2 + 10) * 1000);
    child.on('close', () => {
      clearTimeout(timer);
      const ok = rtts.filter((r): r is number => r !== null).sort((a, b) => a - b);
      resolve({
        rtts,
        medianRttMs: ok.length ? ok[Math.floor(ok.length / 2)]! : null,
        lossPct: rtts.length ? ((rtts.length - ok.length) / rtts.length) * 100 : 100,
      });
    });
    child.on('error', () => resolve({ rtts: [], medianRttMs: null, lossPct: 100 }));
  });
}

/** Projected monthly WAN bytes per mode from configured cadence + recent test sizes. */
function projectMonthlyUsage(repo: Repo): Record<Mode, number> {
  const recent = repo.getRecentSpeedTests(5);
  const avgTestBytes = recent.length
    ? recent.reduce((s, t) => s + t.bytesDown + t.bytesUp, 0) / recent.length
    : 250_000_000; // conservative placeholder until the first tests run
  const wanTargets = repo.listTargets().filter((t) => !t.isLan && t.enabled && t.kind !== 'custom');
  const out = {} as Record<Mode, number>;
  for (const mode of ['eco', 'normal', 'full'] as Mode[]) {
    const cfg = MODES[mode];
    const wanCount = Math.min(cfg.maxWanTargets, Math.max(1, wanTargets.length));
    const perDay =
      wanCount * (86_400 / cfg.pingIntervalSec) * EST_BYTES.pingRoundTrip +
      (86_400 / cfg.dnsIntervalSec) * EST_BYTES.dnsQuery +
      (86_400 / cfg.httpIntervalSec) * 3000 +
      cfg.speedTestsPerDay * avgTestBytes;
    out[mode] = Math.round(perDay * 30);
  }
  return out;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { repo, scheduler, speedEngine, usage, hub } = deps;

  app.get('/health', async () => ({
    ok: true,
    version: VERSION,
    uptimeSec: Math.round((Date.now() - scheduler.startedAt) / 1000),
    sseClients: hub.clientCount(),
  }));

  app.get('/status', async () => scheduler.getStatus());

  app.get('/summary', async (req) => {
    const { from, to } = rangeParams(req.query as Record<string, unknown>);
    return computeSummary(repo, from, to);
  });

  // ------------------------------------------------------------- samples

  app.get('/samples/ping', async (req) => {
    const q = req.query as Record<string, unknown>;
    const { from, to } = rangeParams(q);
    const maxPoints = Math.min(20_000, Math.max(100, Number(q.maxPoints ?? 2000)));
    const targetId = q.targetId !== undefined ? Number(q.targetId) : undefined;
    const samples = repo.getPingSamples(from, to, targetId);
    // Decimate per target so spikes/losses survive.
    const byTarget = new Map<number, { ts: number; value: number | null }[]>();
    for (const s of samples) {
      let list = byTarget.get(s.targetId);
      if (!list) {
        list = [];
        byTarget.set(s.targetId, list);
      }
      list.push({ ts: s.ts, value: s.rttMs });
    }
    const perTargetBudget = Math.max(200, Math.floor(maxPoints / Math.max(1, byTarget.size)));
    return [...byTarget.entries()].map(([tid, points]) => ({
      targetId: tid,
      points: decimateMinMax(points, perTargetBudget).map((p) => [p.ts, p.value]),
    }));
  });

  app.get('/samples/dns', async (req) => {
    const { from, to } = rangeParams(req.query as Record<string, unknown>);
    return repo.getDnsSamples(from, to);
  });

  app.get('/samples/http', async (req) => {
    const { from, to } = rangeParams(req.query as Record<string, unknown>);
    return repo.getHttpSamples(from, to);
  });

  app.get('/rollups/ping', async (req) => {
    const q = req.query as Record<string, unknown>;
    const { from, to } = rangeParams(q);
    return repo.getPingRollups(from, to, q.targetId !== undefined ? Number(q.targetId) : undefined);
  });

  // --------------------------------------------------------- speed tests

  app.get('/speedtests', async (req) => {
    const { from, to } = rangeParams(req.query as Record<string, unknown>);
    return repo.getSpeedTests(from, to);
  });

  app.post('/speedtests', async (req, reply) => {
    if (speedEngine.isRunning()) {
      return reply.code(409).send({ error: 'A speed test is already running' });
    }
    void speedEngine.run('manual').then((result) => {
      if (result) scheduler.checkSpeedDegradation(result.downBps);
    });
    return reply.code(202).send({ started: true });
  });

  // -------------------------------------------------------------- events

  app.get('/events', async (req) => {
    const q = req.query as Record<string, unknown>;
    const { from, to } = rangeParams(q);
    const kind = typeof q.kind === 'string' && q.kind.length > 0 ? (q.kind as never) : undefined;
    return repo.getEvents(from, to, kind);
  });

  app.get('/events/recent', async () => repo.getRecentEvents(50));

  app.get('/events/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const event = repo.getEvent(id);
    if (!event) return reply.code(404).send({ error: 'not found' });
    return { ...event, evidence: repo.getEvidence(id) };
  });

  // --------------------------------------------------------------- usage

  app.get('/usage', async (req) => {
    const q = req.query as Record<string, unknown>;
    const granularity = String(q.granularity ?? 'day');
    const now = Date.now();
    const defaultSpan =
      granularity === 'hour' ? 2 * DAY : granularity === 'day' ? 35 * DAY : 400 * DAY;
    const to = Number(q.to ?? now) || now;
    const from = Number(q.from ?? to - defaultSpan) || to - defaultSpan;

    const hourly = repo.getUsage(from, to);
    // Re-bucket to the requested granularity using local calendar boundaries.
    const keyOf = (ts: number): number => {
      const d = new Date(ts);
      switch (granularity) {
        case 'hour':
          return ts;
        case 'month':
          return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
        case 'year':
          return new Date(d.getFullYear(), 0, 1).getTime();
        default:
          return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      }
    };
    const merged = new Map<string, (typeof hourly)[number]>();
    for (const b of hourly) {
      const bucket = keyOf(b.bucketStart);
      const key = `${bucket}:${b.category}:${b.isLan ? 1 : 0}`;
      const cur = merged.get(key);
      if (cur) {
        cur.bytesSent += b.bytesSent;
        cur.bytesRecv += b.bytesRecv;
      } else {
        merged.set(key, { ...b, bucketStart: bucket });
      }
    }
    const summary: UsageSummary = {
      lifetimeBytes: repo.getLifetimeUsage(),
      buckets: [...merged.values()].sort((a, b) => a.bucketStart - b.bucketStart),
      projections: projectMonthlyUsage(repo),
    };
    return summary;
  });

  // ------------------------------------------------------------ settings

  app.get('/settings', async () => repo.getSettings());

  app.put('/settings', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const merged = mergeSettings(repo.getSettings(), body);
    if ('error' in merged) return reply.code(400).send({ error: merged.error });
    repo.saveSettings(merged.next);
    scheduler.detector.setLatencyThreshold(merged.next.latencyThresholdMs);
    return merged.next;
  });

  app.post('/mode', async (req, reply) => {
    const body = req.body as { mode?: Mode; revertAfterMs?: number };
    if (!body.mode || !['eco', 'normal', 'full'].includes(body.mode)) {
      return reply.code(400).send({ error: 'mode must be eco, normal, or full' });
    }
    scheduler.setMode(body.mode, body.revertAfterMs);
    return scheduler.getStatus();
  });

  app.post('/suggestion/dismiss', async () => {
    scheduler.dismissSuggestion();
    return { ok: true };
  });

  // ------------------------------------------------------------- targets

  app.get('/targets', async () => repo.listTargets());

  app.post('/targets', async (req, reply) => {
    const body = req.body as { host?: string; label?: string };
    if (!validHost(body.host)) return reply.code(400).send({ error: 'invalid host' });
    const target = repo.upsertTarget('custom', body.host, body.label || body.host, false);
    scheduler.reload();
    return target;
  });

  app.patch('/targets/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { enabled?: boolean; host?: string; label?: string };
    const existing = repo.listTargets().find((t) => t.id === id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    if (body.host !== undefined) {
      if (!validHost(body.host)) return reply.code(400).send({ error: 'invalid host' });
      repo.updateTargetHost(id, body.host, body.label ?? existing.label);
    }
    if (body.enabled !== undefined) repo.setTargetEnabled(id, body.enabled);
    scheduler.reload();
    return repo.listTargets().find((t) => t.id === id);
  });

  app.delete('/targets/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const existing = repo.listTargets().find((t) => t.id === id);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    if (existing.kind !== 'custom') {
      return reply.code(400).send({ error: 'only custom targets can be deleted' });
    }
    repo.deleteTarget(id);
    scheduler.reload();
    return { ok: true };
  });

  app.post('/targets/rediscover', async () => {
    await scheduler.refreshTargets();
    scheduler.reload();
    return repo.listTargets();
  });

  // --------------------------------------------------------------- tools

  app.post('/tools/ping', async (req, reply) => {
    const body = req.body as { host?: string; count?: number };
    if (!validHost(body.host)) return reply.code(400).send({ error: 'invalid host' });
    const count = Math.min(20, Math.max(1, Number(body.count ?? 10)));
    const result = await pingBurst(body.host, count);
    usage.add('ping', false, (count * EST_BYTES.pingRoundTrip) / 2, (count * EST_BYTES.pingRoundTrip) / 2);
    return { host: body.host, count, ...result };
  });

  app.post('/tools/mtr', async (req, reply) => {
    const body = req.body as { host?: string };
    if (!validHost(body.host)) return reply.code(400).send({ error: 'invalid host' });
    const { result, error } = await runMtr(body.host, 10);
    usage.add('mtr', false, EST_BYTES.mtrTrace / 2, EST_BYTES.mtrTrace / 2);
    if (!result) return reply.code(502).send({ error: error ?? 'mtr failed' });
    return result;
  });

  app.post('/tools/dns-bench', async () => {
    const results: DnsBenchResult[] = await Promise.all(
      BENCH_RESOLVERS.map(async (r) => {
        const samples: DnsBenchResult['samples'] = [];
        for (const hostname of BENCH_HOSTNAMES) {
          const res = await timedResolve(hostname, r.ip);
          samples.push({ hostname, durationMs: res.durationMs, success: res.success });
        }
        usage.add('dns', false, (BENCH_HOSTNAMES.length * EST_BYTES.dnsQuery) / 2, (BENCH_HOSTNAMES.length * EST_BYTES.dnsQuery) / 2);
        const ok = samples.filter((s) => s.success && s.durationMs !== null);
        const sorted = ok.map((s) => s.durationMs!).sort((a, b) => a - b);
        return {
          resolver: r.ip ?? 'system',
          label: r.label,
          medianMs: sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null,
          successPct: (ok.length / samples.length) * 100,
          samples,
        };
      }),
    );
    return results;
  });

  app.post('/tools/health-check', async () => {
    const targets = repo.listTargets().filter((t) => t.enabled);
    const [pingResults, dnsRes, httpRes] = await Promise.all([
      Promise.all(
        targets.map(async (t) => {
          const r = await pingBurst(t.host, 5);
          usage.add('ping', t.isLan, (5 * EST_BYTES.pingRoundTrip) / 2, (5 * EST_BYTES.pingRoundTrip) / 2);
          return { host: t.host, label: t.label, medianRttMs: r.medianRttMs, lossPct: r.lossPct };
        }),
      ),
      timedResolve('www.google.com', null),
      httpCheck('http://connectivitycheck.gstatic.com/generate_204'),
    ]);
    usage.add('dns', false, EST_BYTES.dnsQuery / 2, EST_BYTES.dnsQuery / 2);
    usage.add('http', false, httpRes.bytesApprox / 2, httpRes.bytesApprox / 2);

    const wan = pingResults.filter((_, i) => !targets[i]!.isLan);
    const wanBad = wan.filter((r) => r.lossPct >= 40).length;
    const verdict: HealthCheckResult['verdict'] =
      wanBad === wan.length && wan.length > 0
        ? 'bad'
        : wanBad > 0 || !dnsRes.success || !httpRes.success
          ? 'degraded'
          : 'good';
    const explanation =
      verdict === 'good'
        ? 'Everything looks healthy: probe targets reachable, DNS answering, web reachable.'
        : verdict === 'degraded'
          ? 'Partially degraded: some checks failed. See the individual results below.'
          : 'The connection looks down: no internet-side targets are reachable.';

    const result: HealthCheckResult = {
      ranAt: Date.now(),
      ping: pingResults,
      dns: { ok: dnsRes.success, durationMs: dnsRes.durationMs, error: dnsRes.error },
      http: { url: httpRes.url, ok: httpRes.success, ttfbMs: httpRes.ttfbMs, error: httpRes.error },
      verdict,
      explanation,
    };
    return result;
  });

  // ------------------------------------------------------------- reports

  app.get('/reports', async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const { from, to } = rangeParams(q);
    const format = String(q.format ?? 'json');
    const payload = buildReportPayload(repo, from, to);
    const stamp = `${new Date(from).toISOString().slice(0, 10)}_${new Date(to).toISOString().slice(0, 10)}`;
    switch (format) {
      case 'html':
        return reply
          .type('text/html; charset=utf-8')
          .header('content-disposition', `inline; filename="trapline-report-${stamp}.html"`)
          .send(renderReportHtml(payload));
      case 'csv':
        return reply
          .type('text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="trapline-report-${stamp}.csv"`)
          .send(buildCsv(payload));
      default:
        return reply
          .header('content-disposition', `attachment; filename="trapline-report-${stamp}.json"`)
          .send(payload);
    }
  });

  // ---------------------------------------------------------------- live

  app.get('/live', (req, reply) => {
    reply.hijack();
    hub.addClient(reply.raw);
    // Push a fresh status immediately so the UI paints without waiting.
    reply.raw.write(
      `event: status\ndata: ${JSON.stringify(scheduler.getStatus())}\n\n`,
    );
  });
}
