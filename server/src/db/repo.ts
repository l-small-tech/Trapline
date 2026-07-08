/**
 * All SQL lives here, grouped by domain. Every statement is prepared once
 * and reused. Timestamps are UTC epoch milliseconds.
 */
import type Database from 'better-sqlite3';
import type { Db } from './db.js';
import type {
  DnsPoint,
  EventClassification,
  EventEvidence,
  EventKind,
  EventSeverity,
  EvidenceKind,
  HttpPoint,
  MonitorEvent,
  PingPoint,
  PingRollup,
  Settings,
  SpeedTestResult,
  Target,
  TargetKind,
  UsageBucket,
  UsageCategory,
} from '../../../shared/types.js';
import { DEFAULT_SETTINGS } from '../config.js';

type Stmt = Database.Statement;

export class Repo {
  private stmts = new Map<string, Stmt>();

  constructor(private db: Db) {}

  private prep(sql: string): Stmt {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ---------------------------------------------------------------- settings

  getSettings(): Settings {
    const row = this.prep('SELECT value FROM settings WHERE key = ?').get('settings') as
      | { value: string }
      | undefined;
    const stored = row ? (JSON.parse(row.value) as Partial<Settings>) : {};
    // Merge over defaults so new fields appear for old installs.
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      plan: { ...DEFAULT_SETTINGS.plan, ...(stored.plan ?? {}) },
    };
  }

  saveSettings(settings: Settings): void {
    this.prep(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run('settings', JSON.stringify(settings));
  }

  getMetaNumber(key: string): number | null {
    const row = this.prep('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row ? Number(row.value) : null;
  }

  setMetaNumber(key: string, value: number | null): void {
    if (value === null) {
      this.prep('DELETE FROM settings WHERE key = ?').run(key);
    } else {
      this.prep(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).run(key, String(value));
    }
  }

  // ----------------------------------------------------------------- targets

  private rowToTarget(r: Record<string, unknown>): Target {
    return {
      id: r.id as number,
      kind: r.kind as TargetKind,
      host: r.host as string,
      label: r.label as string,
      isLan: !!(r.is_lan as number),
      enabled: !!(r.enabled as number),
    };
  }

  listTargets(): Target[] {
    return (this.prep('SELECT * FROM targets ORDER BY id').all() as Record<string, unknown>[]).map(
      (r) => this.rowToTarget(r),
    );
  }

  upsertTarget(kind: TargetKind, host: string, label: string, isLan: boolean): Target {
    this.prep(
      `INSERT INTO targets (kind, host, label, is_lan, enabled, created_at)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(host) DO UPDATE SET kind = excluded.kind, label = excluded.label, is_lan = excluded.is_lan`,
    ).run(kind, host, label, isLan ? 1 : 0, Date.now());
    const row = this.prep('SELECT * FROM targets WHERE host = ?').get(host) as Record<
      string,
      unknown
    >;
    return this.rowToTarget(row);
  }

  setTargetEnabled(id: number, enabled: boolean): void {
    this.prep('UPDATE targets SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  }

  updateTargetHost(id: number, host: string, label: string): void {
    this.prep('UPDATE targets SET host = ?, label = ? WHERE id = ?').run(host, label, id);
  }

  deleteTarget(id: number): void {
    this.prep('DELETE FROM targets WHERE id = ?').run(id);
  }

  // ------------------------------------------------------------------- pings

  insertPing(ts: number, targetId: number, rttMs: number | null): void {
    this.prep('INSERT INTO ping_samples (ts, target_id, rtt_ms, success) VALUES (?, ?, ?, ?)').run(
      ts,
      targetId,
      rttMs,
      rttMs === null ? 0 : 1,
    );
  }

  getPingSamples(from: number, to: number, targetId?: number): PingPoint[] {
    const rows = (
      targetId !== undefined
        ? this.prep(
            'SELECT ts, target_id, rtt_ms FROM ping_samples WHERE target_id = ? AND ts BETWEEN ? AND ? ORDER BY ts',
          ).all(targetId, from, to)
        : this.prep(
            'SELECT ts, target_id, rtt_ms FROM ping_samples WHERE ts BETWEEN ? AND ? ORDER BY ts',
          ).all(from, to)
    ) as { ts: number; target_id: number; rtt_ms: number | null }[];
    return rows.map((r) => ({ ts: r.ts, targetId: r.target_id, rttMs: r.rtt_ms }));
  }

  countPingsInRange(from: number, to: number): { sent: number; lost: number } {
    const r = this.prep(
      'SELECT COUNT(*) AS sent, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS lost FROM ping_samples WHERE ts BETWEEN ? AND ?',
    ).get(from, to) as { sent: number; lost: number | null };
    return { sent: r.sent, lost: r.lost ?? 0 };
  }

  // --------------------------------------------------------------------- dns

  insertDns(
    ts: number,
    resolver: string,
    hostname: string,
    durationMs: number | null,
    success: boolean,
    error: string | null,
  ): void {
    this.prep(
      'INSERT INTO dns_samples (ts, resolver, hostname, duration_ms, success, error) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(ts, resolver, hostname, durationMs, success ? 1 : 0, error);
  }

  getDnsSamples(from: number, to: number): DnsPoint[] {
    const rows = this.prep(
      'SELECT ts, resolver, hostname, duration_ms, success, error FROM dns_samples WHERE ts BETWEEN ? AND ? ORDER BY ts',
    ).all(from, to) as Record<string, unknown>[];
    return rows.map((r) => ({
      ts: r.ts as number,
      resolver: r.resolver as string,
      hostname: r.hostname as string,
      durationMs: r.duration_ms as number | null,
      success: !!(r.success as number),
      error: r.error as string | null,
    }));
  }

  // -------------------------------------------------------------------- http

  insertHttp(
    ts: number,
    url: string,
    status: number | null,
    ttfbMs: number | null,
    totalMs: number | null,
    success: boolean,
    error: string | null,
  ): void {
    this.prep(
      'INSERT INTO http_samples (ts, url, status, ttfb_ms, total_ms, success, error) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(ts, url, status, ttfbMs, totalMs, success ? 1 : 0, error);
  }

  getHttpSamples(from: number, to: number): HttpPoint[] {
    const rows = this.prep(
      'SELECT ts, url, status, ttfb_ms, total_ms, success, error FROM http_samples WHERE ts BETWEEN ? AND ? ORDER BY ts',
    ).all(from, to) as Record<string, unknown>[];
    return rows.map((r) => ({
      ts: r.ts as number,
      url: r.url as string,
      status: r.status as number | null,
      ttfbMs: r.ttfb_ms as number | null,
      totalMs: r.total_ms as number | null,
      success: !!(r.success as number),
      error: r.error as string | null,
    }));
  }

  // ------------------------------------------------------------- speed tests

  insertSpeedTest(t: Omit<SpeedTestResult, 'id'> & { detail?: unknown }): number {
    const info = this.prep(
      `INSERT INTO speed_tests
        (ts, trigger_kind, down_bps, up_bps, idle_latency_ms, loaded_down_ms, loaded_up_ms,
         bufferbloat_grade, bytes_down, bytes_up, duration_ms, error, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      t.ts,
      t.trigger,
      t.downBps,
      t.upBps,
      t.idleLatencyMs,
      t.loadedDownMs,
      t.loadedUpMs,
      t.bufferbloatGrade,
      t.bytesDown,
      t.bytesUp,
      t.durationMs,
      t.error,
      JSON.stringify(t.detail ?? {}),
    );
    return Number(info.lastInsertRowid);
  }

  private rowToSpeedTest(r: Record<string, unknown>): SpeedTestResult {
    return {
      id: r.id as number,
      ts: r.ts as number,
      trigger: r.trigger_kind as SpeedTestResult['trigger'],
      downBps: r.down_bps as number | null,
      upBps: r.up_bps as number | null,
      idleLatencyMs: r.idle_latency_ms as number | null,
      loadedDownMs: r.loaded_down_ms as number | null,
      loadedUpMs: r.loaded_up_ms as number | null,
      bufferbloatGrade: r.bufferbloat_grade as SpeedTestResult['bufferbloatGrade'],
      bytesDown: r.bytes_down as number,
      bytesUp: r.bytes_up as number,
      durationMs: r.duration_ms as number,
      error: r.error as string | null,
    };
  }

  getSpeedTests(from: number, to: number): SpeedTestResult[] {
    const rows = this.prep(
      'SELECT * FROM speed_tests WHERE ts BETWEEN ? AND ? ORDER BY ts',
    ).all(from, to) as Record<string, unknown>[];
    return rows.map((r) => this.rowToSpeedTest(r));
  }

  getRecentSpeedTests(limit: number): SpeedTestResult[] {
    const rows = this.prep(
      'SELECT * FROM speed_tests WHERE error IS NULL ORDER BY ts DESC LIMIT ?',
    ).all(limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToSpeedTest(r));
  }

  // ------------------------------------------------------------------ events

  private rowToEvent(r: Record<string, unknown>): MonitorEvent {
    return {
      id: r.id as number,
      kind: r.kind as EventKind,
      severity: r.severity as EventSeverity,
      classification: r.classification as EventClassification,
      startedAt: r.started_at as number,
      endedAt: r.ended_at as number | null,
      summary: r.summary as string,
      detail: JSON.parse((r.detail as string) || '{}'),
    };
  }

  openEvent(
    kind: EventKind,
    severity: EventSeverity,
    classification: EventClassification,
    startedAt: number,
    summary: string,
    detail: Record<string, unknown> = {},
  ): MonitorEvent {
    const info = this.prep(
      `INSERT INTO events (kind, severity, classification, started_at, ended_at, summary, detail)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    ).run(kind, severity, classification, startedAt, summary, JSON.stringify(detail));
    return this.getEvent(Number(info.lastInsertRowid))!;
  }

  /** Insert an already-finished event (e.g. speed_degradation, monitor_gap). */
  insertClosedEvent(
    kind: EventKind,
    severity: EventSeverity,
    classification: EventClassification,
    startedAt: number,
    endedAt: number,
    summary: string,
    detail: Record<string, unknown> = {},
  ): MonitorEvent {
    const info = this.prep(
      `INSERT INTO events (kind, severity, classification, started_at, ended_at, summary, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(kind, severity, classification, startedAt, endedAt, summary, JSON.stringify(detail));
    return this.getEvent(Number(info.lastInsertRowid))!;
  }

  closeEvent(
    id: number,
    endedAt: number,
    severity: EventSeverity,
    classification: EventClassification,
    summary: string,
    detail: Record<string, unknown>,
  ): MonitorEvent {
    this.prep(
      'UPDATE events SET ended_at = ?, severity = ?, classification = ?, summary = ?, detail = ? WHERE id = ?',
    ).run(endedAt, severity, classification, summary, JSON.stringify(detail), id);
    return this.getEvent(id)!;
  }

  getEvent(id: number): MonitorEvent | null {
    const r = this.prep('SELECT * FROM events WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? this.rowToEvent(r) : null;
  }

  getOpenEvents(): MonitorEvent[] {
    const rows = this.prep(
      'SELECT * FROM events WHERE ended_at IS NULL ORDER BY started_at',
    ).all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToEvent(r));
  }

  /** Events overlapping [from, to]. */
  getEvents(from: number, to: number, kind?: EventKind): MonitorEvent[] {
    const rows = (
      kind
        ? this.prep(
            `SELECT * FROM events WHERE kind = ? AND started_at <= ? AND (ended_at IS NULL OR ended_at >= ?)
             ORDER BY started_at DESC`,
          ).all(kind, to, from)
        : this.prep(
            `SELECT * FROM events WHERE started_at <= ? AND (ended_at IS NULL OR ended_at >= ?)
             ORDER BY started_at DESC`,
          ).all(to, from)
    ) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEvent(r));
  }

  getRecentEvents(limit: number): MonitorEvent[] {
    const rows = this.prep('SELECT * FROM events ORDER BY started_at DESC LIMIT ?').all(
      limit,
    ) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEvent(r));
  }

  addEvidence(eventId: number, kind: EvidenceKind, capturedAt: number, content: unknown): void {
    this.prep(
      'INSERT INTO event_evidence (event_id, kind, captured_at, content) VALUES (?, ?, ?, ?)',
    ).run(eventId, kind, capturedAt, JSON.stringify(content));
  }

  getEvidence(eventId: number): EventEvidence[] {
    const rows = this.prep(
      'SELECT * FROM event_evidence WHERE event_id = ? ORDER BY captured_at',
    ).all(eventId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      eventId: r.event_id as number,
      kind: r.kind as EvidenceKind,
      capturedAt: r.captured_at as number,
      content: JSON.parse(r.content as string),
    }));
  }

  // ----------------------------------------------------------------- rollups

  upsertPingRollup(r: PingRollup): void {
    this.prep(
      `INSERT INTO ping_rollups_hourly
        (hour_start, target_id, sent, lost, rtt_avg, rtt_min, rtt_max, rtt_p50, rtt_p95, rtt_p99, jitter_avg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(hour_start, target_id) DO UPDATE SET
        sent = excluded.sent, lost = excluded.lost, rtt_avg = excluded.rtt_avg,
        rtt_min = excluded.rtt_min, rtt_max = excluded.rtt_max, rtt_p50 = excluded.rtt_p50,
        rtt_p95 = excluded.rtt_p95, rtt_p99 = excluded.rtt_p99, jitter_avg = excluded.jitter_avg`,
    ).run(
      r.hourStart,
      r.targetId,
      r.sent,
      r.lost,
      r.rttAvg,
      r.rttMin,
      r.rttMax,
      r.rttP50,
      r.rttP95,
      r.rttP99,
      r.jitterAvg,
    );
  }

  upsertDnsRollup(hourStart: number, count: number, failures: number, p50: number | null, p95: number | null): void {
    this.prep(
      `INSERT INTO dns_rollups_hourly (hour_start, count, failures, p50, p95) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(hour_start) DO UPDATE SET count = excluded.count, failures = excluded.failures,
        p50 = excluded.p50, p95 = excluded.p95`,
    ).run(hourStart, count, failures, p50, p95);
  }

  upsertHttpRollup(hourStart: number, count: number, failures: number, ttfbP50: number | null, ttfbP95: number | null): void {
    this.prep(
      `INSERT INTO http_rollups_hourly (hour_start, count, failures, ttfb_p50, ttfb_p95) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(hour_start) DO UPDATE SET count = excluded.count, failures = excluded.failures,
        ttfb_p50 = excluded.ttfb_p50, ttfb_p95 = excluded.ttfb_p95`,
    ).run(hourStart, count, failures, ttfbP50, ttfbP95);
  }

  getPingRollups(from: number, to: number, targetId?: number): PingRollup[] {
    const rows = (
      targetId !== undefined
        ? this.prep(
            'SELECT * FROM ping_rollups_hourly WHERE target_id = ? AND hour_start BETWEEN ? AND ? ORDER BY hour_start',
          ).all(targetId, from, to)
        : this.prep(
            'SELECT * FROM ping_rollups_hourly WHERE hour_start BETWEEN ? AND ? ORDER BY hour_start',
          ).all(from, to)
    ) as Record<string, unknown>[];
    return rows.map((r) => ({
      hourStart: r.hour_start as number,
      targetId: r.target_id as number,
      sent: r.sent as number,
      lost: r.lost as number,
      rttAvg: r.rtt_avg as number | null,
      rttMin: r.rtt_min as number | null,
      rttMax: r.rtt_max as number | null,
      rttP50: r.rtt_p50 as number | null,
      rttP95: r.rtt_p95 as number | null,
      rttP99: r.rtt_p99 as number | null,
      jitterAvg: r.jitter_avg as number | null,
    }));
  }

  getLastRollupHour(): number | null {
    const r = this.prep('SELECT MAX(hour_start) AS h FROM ping_rollups_hourly').get() as {
      h: number | null;
    };
    return r.h;
  }

  getOldestPingTs(): number | null {
    const r = this.prep('SELECT MIN(ts) AS t FROM ping_samples').get() as { t: number | null };
    return r.t;
  }

  getLastPingTs(): number | null {
    const r = this.prep('SELECT MAX(ts) AS t FROM ping_samples').get() as { t: number | null };
    return r.t;
  }

  // ------------------------------------------------------------------- usage

  addUsage(hourStart: number, category: UsageCategory, isLan: boolean, sent: number, recv: number): void {
    this.prep(
      `INSERT INTO data_usage_hourly (hour_start, category, is_lan, bytes_sent, bytes_recv)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(hour_start, category, is_lan) DO UPDATE SET
        bytes_sent = bytes_sent + excluded.bytes_sent,
        bytes_recv = bytes_recv + excluded.bytes_recv`,
    ).run(hourStart, category, isLan ? 1 : 0, Math.round(sent), Math.round(recv));
  }

  getUsage(from: number, to: number): UsageBucket[] {
    const rows = this.prep(
      'SELECT * FROM data_usage_hourly WHERE hour_start BETWEEN ? AND ? ORDER BY hour_start',
    ).all(from, to) as Record<string, unknown>[];
    return rows.map((r) => ({
      bucketStart: r.hour_start as number,
      category: r.category as UsageCategory,
      isLan: !!(r.is_lan as number),
      bytesSent: r.bytes_sent as number,
      bytesRecv: r.bytes_recv as number,
    }));
  }

  getLifetimeUsage(): number {
    const r = this.prep(
      'SELECT COALESCE(SUM(bytes_sent + bytes_recv), 0) AS total FROM data_usage_hourly WHERE is_lan = 0',
    ).get() as { total: number };
    return r.total;
  }

  // --------------------------------------------------------------- retention

  purgeOldSamples(pingCutoff: number, dnsHttpCutoff: number): { pings: number; dns: number; http: number } {
    const pings = this.prep('DELETE FROM ping_samples WHERE ts < ?').run(pingCutoff).changes;
    const dns = this.prep('DELETE FROM dns_samples WHERE ts < ?').run(dnsHttpCutoff).changes;
    const http = this.prep('DELETE FROM http_samples WHERE ts < ?').run(dnsHttpCutoff).changes;
    return { pings, dns, http };
  }

  vacuumIncremental(): void {
    this.db.pragma('incremental_vacuum');
    this.db.pragma('optimize');
  }
}
