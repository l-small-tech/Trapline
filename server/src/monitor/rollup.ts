/**
 * Hourly aggregation of raw samples into the *_rollups_hourly tables, plus
 * daily retention purges. Rollups are idempotent UPSERTs, and on boot we
 * backfill any hours that raw data still covers, so restarts lose nothing.
 */
import type { Repo } from '../db/repo.js';
import { jitter, mean, percentile } from '../util/stats.js';
import { DAY, HOUR, hourStart } from '../util/time.js';

export class RollupJob {
  private timer: NodeJS.Timeout | null = null;
  private lastPurgeDay: number | null = null;

  constructor(
    private repo: Repo,
    private log: (msg: string) => void,
  ) {}

  start(): void {
    this.backfill();
    this.timer = setInterval(() => this.tick(), 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private tick(): void {
    try {
      this.backfill();
      this.maybePurge();
    } catch (err) {
      this.log(`rollup tick failed: ${String(err)}`);
    }
  }

  /** Roll up every fully-elapsed hour that raw data covers and rollups miss. */
  backfill(): void {
    const currentHour = hourStart(Date.now());
    const oldestRaw = this.repo.getOldestPingTs();
    if (oldestRaw === null) return;
    const lastDone = this.repo.getLastRollupHour();
    let from = lastDone !== null ? lastDone + HOUR : hourStart(oldestRaw);
    from = Math.max(from, hourStart(oldestRaw));
    for (let hour = from; hour < currentHour; hour += HOUR) {
      this.rollupHour(hour);
    }
  }

  rollupHour(hour: number): void {
    const from = hour;
    const to = hour + HOUR - 1;

    // Pings, per target.
    const samples = this.repo.getPingSamples(from, to);
    const byTarget = new Map<number, { rtts: number[]; sent: number; lost: number }>();
    for (const s of samples) {
      let agg = byTarget.get(s.targetId);
      if (!agg) {
        agg = { rtts: [], sent: 0, lost: 0 };
        byTarget.set(s.targetId, agg);
      }
      agg.sent += 1;
      if (s.rttMs === null) agg.lost += 1;
      else agg.rtts.push(s.rttMs);
    }
    for (const [targetId, agg] of byTarget) {
      const sorted = [...agg.rtts].sort((a, b) => a - b);
      this.repo.upsertPingRollup({
        hourStart: hour,
        targetId,
        sent: agg.sent,
        lost: agg.lost,
        rttAvg: mean(agg.rtts),
        rttMin: sorted[0] ?? null,
        rttMax: sorted[sorted.length - 1] ?? null,
        rttP50: percentile(sorted, 0.5),
        rttP95: percentile(sorted, 0.95),
        rttP99: percentile(sorted, 0.99),
        jitterAvg: jitter(agg.rtts),
      });
    }

    // DNS.
    const dns = this.repo.getDnsSamples(from, to).filter((d) => d.resolver === 'system');
    if (dns.length > 0) {
      const durations = dns
        .filter((d) => d.success && d.durationMs !== null)
        .map((d) => d.durationMs!)
        .sort((a, b) => a - b);
      this.repo.upsertDnsRollup(
        hour,
        dns.length,
        dns.filter((d) => !d.success).length,
        percentile(durations, 0.5),
        percentile(durations, 0.95),
      );
    }

    // HTTP.
    const http = this.repo.getHttpSamples(from, to);
    if (http.length > 0) {
      const ttfbs = http
        .filter((h) => h.success && h.ttfbMs !== null)
        .map((h) => h.ttfbMs!)
        .sort((a, b) => a - b);
      this.repo.upsertHttpRollup(
        hour,
        http.length,
        http.filter((h) => !h.success).length,
        percentile(ttfbs, 0.5),
        percentile(ttfbs, 0.95),
      );
    }
  }

  /** Daily retention purge at ~04:10 local time. */
  private maybePurge(): void {
    const now = new Date();
    const dayKey = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    if (this.lastPurgeDay === dayKey) return;
    if (now.getHours() < 4 || (now.getHours() === 4 && now.getMinutes() < 10)) return;
    this.lastPurgeDay = dayKey;

    const settings = this.repo.getSettings();
    const pingCutoff = Date.now() - settings.retentionPingDays * DAY;
    const dnsHttpCutoff = Date.now() - settings.retentionDnsHttpDays * DAY;
    const purged = this.repo.purgeOldSamples(pingCutoff, dnsHttpCutoff);
    this.repo.vacuumIncremental();
    this.log(
      `retention purge: ${purged.pings} ping, ${purged.dns} dns, ${purged.http} http samples removed`,
    );
  }
}
