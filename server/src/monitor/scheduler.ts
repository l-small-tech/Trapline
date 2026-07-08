/**
 * The scheduler owns all recurring work: ping probe processes, DNS/HTTP
 * check timers, speed-test scheduling, mode switching (with Full Capture
 * auto-revert), monitor-gap detection, and pushing live updates to the SSE
 * hub. Everything is derived from MODES[mode] in config.ts.
 */
import type {
  DnsPoint,
  HttpPoint,
  Mode,
  MonitorEvent,
  PingPoint,
  SseMessage,
  StatusSnapshot,
  Target,
} from '../../../shared/types.js';
import {
  ANCHORS,
  DNS_PROBE_HOSTNAMES,
  EST_BYTES,
  FULL_CAPTURE_DEFAULT_REVERT_MS,
  HTTP_PROBE_URLS,
  MODES,
  VERSION,
} from '../config.js';
import type { Repo } from '../db/repo.js';
import { discoverTargets } from '../probes/discovery.js';
import { timedResolve } from '../probes/dns.js';
import { httpCheck } from '../probes/http.js';
import { PingProbe } from '../probes/ping.js';
import type { SpeedTestEngine } from '../speedtest/engine.js';
import { MINUTE } from '../util/time.js';
import { Detector, type ClosedEvent, type OpenedEvent } from './detector.js';
import type { EvidenceCollector } from './evidence.js';
import type { UsageLedger } from './usage.js';

export interface Broadcaster {
  broadcast(msg: SseMessage): void;
}

const META_REVERT_AT = 'revert_at';
const META_DISMISSED_UNTIL = 'dismissed_suggestion_until';
const GAP_TICK_MS = 5000;

export class Scheduler {
  readonly detector: Detector;
  private probes: PingProbe[] = [];
  private timers: NodeJS.Timeout[] = [];
  private activeTargets: Target[] = [];
  private dnsHostIndex = 0;
  private httpUrlIndex = 0;
  private lastGapTick = Date.now();
  private stateSince = Date.now();
  private lastState: StatusSnapshot['state'] = 'up';
  private openEventIds = new Map<string, number>(); // event kind -> db id
  private speedSchedule: number[] = [];
  private scheduleDay = -1;
  private sampleBuffer: { ping: PingPoint[]; dns: DnsPoint[]; http: HttpPoint[] } = {
    ping: [],
    dns: [],
    http: [],
  };
  readonly startedAt = Date.now();

  constructor(
    private repo: Repo,
    private usage: UsageLedger,
    private evidence: EvidenceCollector,
    private speedEngine: SpeedTestEngine,
    private hub: Broadcaster,
    private log: (msg: string) => void,
  ) {
    this.detector = new Detector(
      {
        onOpen: (e) => this.handleEventOpen(e),
        onClose: (e) => this.handleEventClose(e),
        onSuggestFullCapture: (reason) => this.handleSuggestion(reason),
      },
      MODES[this.getMode()].pingIntervalSec,
      this.repo.getSettings().latencyThresholdMs,
    );
  }

  // -------------------------------------------------------------- lifecycle

  async start(): Promise<void> {
    this.recoverFromRestart();
    await this.refreshTargets();
    this.applyMode(this.getMode());

    // Discovery above can take ~20s; reset the gap clock so the first tick
    // doesn't read startup time as a monitoring gap.
    this.lastGapTick = Date.now();
    this.timers.push(setInterval(() => this.gapTick(), GAP_TICK_MS));
    this.timers.push(setInterval(() => this.flushSamples(), 2000));
    this.timers.push(setInterval(() => this.broadcastStatus(), 30_000));
    for (const t of this.timers) t.unref();
    this.broadcastStatus();
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.stopProbes();
  }

  /** Close events left open by a crash, and record the downtime as a gap. */
  private recoverFromRestart(): void {
    const now = Date.now();
    const open = this.repo.getOpenEvents();
    for (const e of open) {
      this.repo.closeEvent(e.id, now, e.severity, e.classification, e.summary, {
        ...e.detail,
        closedBy: 'monitor restart — true end time unknown',
      });
    }
    const lastPingTs = this.repo.getLastPingTs();
    if (lastPingTs !== null && now - lastPingTs > 2 * MINUTE) {
      this.repo.insertClosedEvent(
        'monitor_gap',
        'info',
        'unknown',
        lastPingTs,
        now,
        'Monitor was not running — this period is excluded from uptime statistics',
        { reason: 'restart' },
      );
    }
  }

  // ------------------------------------------------------------------ mode

  getMode(): Mode {
    return this.repo.getSettings().mode;
  }

  getRevertAt(): number | null {
    return this.repo.getMetaNumber(META_REVERT_AT);
  }

  setMode(mode: Mode, revertAfterMs?: number): void {
    const settings = this.repo.getSettings();
    settings.mode = mode;
    this.repo.saveSettings(settings);
    if (mode === 'full') {
      const revertMs = revertAfterMs ?? FULL_CAPTURE_DEFAULT_REVERT_MS;
      this.repo.setMetaNumber(META_REVERT_AT, revertMs > 0 ? Date.now() + revertMs : null);
    } else {
      this.repo.setMetaNumber(META_REVERT_AT, null);
    }
    this.applyMode(mode);
    this.log(`mode changed to ${mode}`);
    this.broadcastStatus();
  }

  dismissSuggestion(forMs = 6 * 3600 * 1000): void {
    this.repo.setMetaNumber(META_DISMISSED_UNTIL, Date.now() + forMs);
  }

  private applyMode(mode: Mode): void {
    const cfg = MODES[mode];
    this.stopProbes();

    const all = this.repo.listTargets().filter((t) => t.enabled);
    const gateway = all.filter((t) => t.kind === 'gateway');
    const ispHop = all.filter((t) => t.kind === 'isp_hop');
    const anchors = all.filter((t) => t.kind === 'anchor');
    const custom = all.filter((t) => t.kind === 'custom');

    // WAN detection targets, capped per mode (ISP hop first — it carries
    // the most classification signal).
    const wan = [...ispHop, ...anchors].slice(0, cfg.maxWanTargets);
    this.activeTargets = [...gateway, ...wan, ...custom];

    this.detector.setPingInterval(cfg.pingIntervalSec);
    this.detector.setTargets(this.activeTargets);

    for (const target of this.activeTargets) {
      const probe = new PingProbe({
        host: target.host,
        intervalSec: cfg.pingIntervalSec,
        onLog: (m) => this.log(m),
        onSample: (s) => {
          this.repo.insertPing(s.ts, target.id, s.rttMs);
          this.usage.add('ping', target.isLan, EST_BYTES.pingRoundTrip / 2, EST_BYTES.pingRoundTrip / 2);
          this.detector.onPing({ ts: s.ts, targetId: target.id, rttMs: s.rttMs });
          this.sampleBuffer.ping.push({ ts: s.ts, targetId: target.id, rttMs: s.rttMs });
        },
      });
      probe.start();
      this.probes.push(probe);
    }

    const dnsTimer = setInterval(() => void this.dnsProbe(), cfg.dnsIntervalSec * 1000);
    const httpTimer = setInterval(() => void this.httpProbe(cfg.httpUrls), cfg.httpIntervalSec * 1000);
    const speedTimer = setInterval(() => void this.speedTick(), 30_000);
    dnsTimer.unref();
    httpTimer.unref();
    speedTimer.unref();
    this.timersPerMode.push(dnsTimer, httpTimer, speedTimer);

    this.rebuildSpeedSchedule();
  }

  private timersPerMode: NodeJS.Timeout[] = [];

  private stopProbes(): void {
    for (const p of this.probes) p.stop();
    this.probes = [];
    for (const t of this.timersPerMode) clearInterval(t);
    this.timersPerMode = [];
  }

  // --------------------------------------------------------------- targets

  async refreshTargets(): Promise<void> {
    try {
      const { gateway, ispHop } = await discoverTargets();
      if (gateway) this.repo.upsertTarget('gateway', gateway, 'Your router (gateway)', true);
      if (ispHop) this.repo.upsertTarget('isp_hop', ispHop, 'ISP first hop', false);
      for (const a of ANCHORS) this.repo.upsertTarget('anchor', a.host, a.label, false);
      this.log(`targets: gateway=${gateway ?? 'none'} ispHop=${ispHop ?? 'none'}`);
    } catch (err) {
      this.log(`target discovery failed: ${String(err)}`);
    }
  }

  /** Re-apply targets/probes after the user edits them in Settings. */
  reload(): void {
    this.applyMode(this.getMode());
    this.broadcastStatus();
  }

  // ---------------------------------------------------------------- probes

  private async dnsProbe(): Promise<void> {
    const hostname = DNS_PROBE_HOSTNAMES[this.dnsHostIndex % DNS_PROBE_HOSTNAMES.length]!;
    this.dnsHostIndex += 1;
    const r = await timedResolve(hostname, null);
    this.repo.insertDns(r.ts, 'system', r.hostname, r.durationMs, r.success, r.error);
    this.usage.add('dns', false, EST_BYTES.dnsQuery / 2, EST_BYTES.dnsQuery / 2);
    this.detector.onDns(r.ts, r.success, r.durationMs);
    this.sampleBuffer.dns.push({
      ts: r.ts,
      resolver: 'system',
      hostname: r.hostname,
      durationMs: r.durationMs,
      success: r.success,
      error: r.error,
    });
  }

  private async httpProbe(urlCount: number): Promise<void> {
    const urls = HTTP_PROBE_URLS.slice(0, urlCount);
    const url = urls[this.httpUrlIndex % urls.length]!;
    this.httpUrlIndex += 1;
    const r = await httpCheck(url);
    this.repo.insertHttp(r.ts, r.url, r.status, r.ttfbMs, r.totalMs, r.success, r.error);
    this.usage.add('http', false, r.bytesApprox / 2, r.bytesApprox / 2);
    this.sampleBuffer.http.push({
      ts: r.ts,
      url: r.url,
      status: r.status,
      ttfbMs: r.ttfbMs,
      totalMs: r.totalMs,
      success: r.success,
      error: r.error,
    });
  }

  // ------------------------------------------------------------ speed tests

  private rebuildSpeedSchedule(): void {
    const now = new Date();
    this.scheduleDay = now.getDate();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const cfg = MODES[this.getMode()];
    const times: number[] = [];
    if (cfg.speedTestsPerDay === 1) {
      // Eco: one test overnight (01:00–05:00 local) to spare the data cap.
      times.push(dayStart + (1 + Math.random() * 4) * 3600 * 1000);
    } else {
      // Spread windows across the day, one test at a random point in each.
      const windowMs = (24 * 3600 * 1000) / cfg.speedTestsPerDay;
      for (let i = 0; i < cfg.speedTestsPerDay; i++) {
        times.push(dayStart + i * windowMs + Math.random() * windowMs);
      }
    }
    this.speedSchedule = times.filter((t) => t > Date.now()).sort((a, b) => a - b);
    this.log(
      `speed tests scheduled today: ${this.speedSchedule
        .map((t) => new Date(t).toLocaleTimeString())
        .join(', ') || '(none remaining)'}`,
    );
  }

  private async speedTick(): Promise<void> {
    // Regenerate the schedule when the local day rolls over.
    if (new Date().getDate() !== this.scheduleDay) this.rebuildSpeedSchedule();

    // Full Capture auto-revert.
    const revertAt = this.getRevertAt();
    if (this.getMode() === 'full' && revertAt !== null && Date.now() >= revertAt) {
      this.log('Full Capture auto-revert timer elapsed — returning to Normal');
      this.setMode('normal');
      return;
    }

    const due = this.speedSchedule[0];
    if (due === undefined || Date.now() < due) return;

    if (this.detector.hasOpenOutage()) {
      // No point measuring speed with the line down; retry in 10 minutes.
      this.speedSchedule[0] = Date.now() + 10 * MINUTE;
      return;
    }
    this.speedSchedule.shift();
    const result = await this.speedEngine.run('scheduled');
    if (result) this.checkSpeedDegradation(result.downBps);
  }

  checkSpeedDegradation(downBps: number | null): void {
    if (downBps === null) return;
    const settings = this.repo.getSettings();
    const planDown = settings.plan.downMbps;
    if (!planDown) return;
    const fraction = downBps / (planDown * 1e6);
    if (fraction < settings.speedDegradationFraction) {
      const now = Date.now();
      const event = this.repo.insertClosedEvent(
        'speed_degradation',
        'info',
        'isp',
        now,
        now,
        `Measured ${(downBps / 1e6).toFixed(1)} Mbps down — only ${Math.round(
          fraction * 100,
        )}% of the advertised ${planDown} Mbps plan`,
        { downBps, planDownMbps: planDown, fraction },
      );
      this.hub.broadcast({ type: 'event', data: { action: 'opened', event } });
    }
  }

  // ------------------------------------------------------------- gap watch

  private gapTick(): void {
    const now = Date.now();
    const expected = GAP_TICK_MS;
    const actual = now - this.lastGapTick;
    this.lastGapTick = now;
    const threshold = Math.max(2 * MODES[this.getMode()].pingIntervalSec * 1000 + 5000, 3 * expected);
    if (actual > threshold) {
      const event = this.repo.insertClosedEvent(
        'monitor_gap',
        'info',
        'unknown',
        now - actual,
        now,
        'Monitor paused (system suspend or heavy load) — period excluded from uptime statistics',
        { gapMs: actual },
      );
      this.hub.broadcast({ type: 'event', data: { action: 'opened', event } });
    }
  }

  // ----------------------------------------------------------- event wiring

  private handleEventOpen(e: OpenedEvent): void {
    const event = this.repo.openEvent(
      e.kind,
      e.severity,
      e.classification,
      e.startedAt,
      e.summary,
      e.detail,
    );
    this.openEventIds.set(e.kind, event.id);
    this.hub.broadcast({ type: 'event', data: { action: 'opened', event } });
    this.evidence.onEventOpened(event);
    this.broadcastStatus();
    this.log(`event opened: ${e.kind} (${e.classification}) — ${e.summary}`);
  }

  private handleEventClose(e: ClosedEvent): void {
    const id = this.openEventIds.get(e.kind);
    this.openEventIds.delete(e.kind);
    if (id === undefined) return;
    const event = this.repo.closeEvent(id, e.endedAt, e.severity, e.classification, e.summary, e.detail);
    this.hub.broadcast({ type: 'event', data: { action: 'closed', event } });
    this.evidence.onEventClosed(event);
    this.broadcastStatus();
    this.log(`event closed: ${e.kind} after ${Math.round((e.endedAt - e.startedAt) / 1000)}s`);
  }

  private handleSuggestion(reason: string): void {
    if (this.getMode() === 'full') return;
    const dismissedUntil = this.repo.getMetaNumber(META_DISMISSED_UNTIL);
    if (dismissedUntil !== null && Date.now() < dismissedUntil) return;
    this.hub.broadcast({ type: 'suggestion', data: { suggest: 'full', reason } });
  }

  // ---------------------------------------------------------------- status

  getStatus(): StatusSnapshot {
    const state: StatusSnapshot['state'] = this.detector.hasOpenOutage()
      ? 'down'
      : this.detector.hasOpenDegradation()
        ? 'degraded'
        : 'up';
    if (state !== this.lastState) {
      this.lastState = state;
      this.stateSince = Date.now();
    }
    return {
      state,
      stateSince: this.stateSince,
      mode: this.getMode(),
      revertAt: this.getRevertAt(),
      targets: this.activeTargets.map((t) => {
        const last = this.detector.getLastRtt(t.id);
        return {
          target: t,
          lastRttMs: last.rtt,
          lastSampleAt: last.ts,
          recentLossPct: Math.round(this.detector.getRecentLossPct(t.id) * 10) / 10,
        };
      }),
      openEvents: this.repo.getOpenEvents(),
      mtrAvailable: this.evidence.mtrAvailable,
      serverStartedAt: this.startedAt,
      version: VERSION,
    };
  }

  private broadcastStatus(): void {
    this.hub.broadcast({ type: 'status', data: this.getStatus() });
  }

  private flushSamples(): void {
    const buf = this.sampleBuffer;
    if (buf.ping.length === 0 && buf.dns.length === 0 && buf.http.length === 0) return;
    this.sampleBuffer = { ping: [], dns: [], http: [] };
    this.hub.broadcast({ type: 'samples', data: buf });
  }
}
