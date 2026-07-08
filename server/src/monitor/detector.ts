/**
 * Anomaly / outage detection state machines.
 *
 * The detector is a pure in-memory component: it consumes probe samples
 * (with their own timestamps, so it is fully unit-testable with synthetic
 * streams) and emits open/close callbacks. The scheduler wires those
 * callbacks to the database and the SSE stream.
 *
 * Rules (also documented in the report methodology appendix):
 *  - Outage: >=3 consecutive lost pings on EVERY enabled WAN detection
 *    target simultaneously. Closes after >=3 consecutive successes on at
 *    least two WAN targets (or the only one, if just one is enabled).
 *  - Classification: gateway also down -> 'lan' (the problem is in the
 *    home); gateway up + ISP first hop down -> 'isp'; gateway up + ISP hop
 *    up-or-absent -> 'upstream'/'unknown'.
 *  - Packet loss: >=5% loss over the trailing 60 samples on >=2 WAN
 *    targets; closes when all are back under 2% for 120 samples.
 *  - Latency spike: 60s rolling median above max(2x 1-hour EWMA baseline,
 *    baseline+30ms) sustained >=30s on >=2 WAN targets; closes after 60s
 *    below 1.3x baseline.
 *  - High latency: 60s rolling median above the user-set absolute threshold
 *    (default 120ms, 0 disables) sustained >=30s on >=2 WAN targets; closes
 *    after 60s below 90% of the threshold on all targets.
 *  - DNS failure: 2 consecutive system-resolver failures (or >2s answers);
 *    closes on 2 consecutive successes.
 */
import type {
  EventClassification,
  EventKind,
  EventSeverity,
  Target,
} from '../../../shared/types.js';
import { Ewma, median } from '../util/stats.js';

export interface DetectorSample {
  ts: number;
  targetId: number;
  rttMs: number | null;
}

export interface OpenedEvent {
  kind: EventKind;
  severity: EventSeverity;
  classification: EventClassification;
  startedAt: number;
  summary: string;
  detail: Record<string, unknown>;
}

export interface ClosedEvent extends OpenedEvent {
  endedAt: number;
}

export interface DetectorCallbacks {
  onOpen: (event: OpenedEvent) => void;
  onClose: (event: ClosedEvent) => void;
  onSuggestFullCapture: (reason: string) => void;
}

const OUTAGE_OPEN_LOSSES = 3;
const OUTAGE_CLOSE_SUCCESSES = 3;
const LOSS_WINDOW = 60;
const LOSS_OPEN_PCT = 5;
const LOSS_CLOSE_PCT = 2;
const LOSS_CLOSE_SAMPLES = 120;
const LATENCY_MEDIAN_WINDOW_MS = 60_000;
const LATENCY_SUSTAIN_MS = 30_000;
const LATENCY_CLOSE_MS = 60_000;
const LATENCY_ABS_MARGIN_MS = 30;
const HIGH_LATENCY_DEFAULT_MS = 120;
const HIGH_LATENCY_SUSTAIN_MS = 30_000;
const HIGH_LATENCY_CLOSE_MS = 60_000;
const HIGH_LATENCY_CLOSE_FRACTION = 0.9;
const DNS_FAIL_COUNT = 2;
const DNS_SLOW_MS = 2000;
const SUGGEST_EVENT_COUNT = 3;
const SUGGEST_WINDOW_MS = 30 * 60 * 1000;

interface TargetState {
  target: Target;
  consecutiveLost: number;
  consecutiveOk: number;
  /** Trailing window of success flags (true = reply received). */
  lossWindow: boolean[];
  /** Recent (ts, rtt) pairs within the latency median window. */
  recent: { ts: number; rtt: number }[];
  /** ~1 hour EWMA baseline of RTT (alpha set from ping interval). */
  baseline: Ewma;
  /** When the current spike condition started, or null. */
  spikeSince: number | null;
  /** When the current below-close-threshold stretch started, or null. */
  calmSince: number | null;
  /** When the median went above the absolute high-latency threshold, or null. */
  highSince: number | null;
  /** When the median dropped below the high-latency close threshold, or null. */
  highCalmSince: number | null;
  lastRtt: number | null;
  lastTs: number | null;
  samplesUnderClosePct: number;
}

interface OpenState {
  startedAt: number;
  detail: Record<string, unknown>;
  /** Classification determined while the event was live (see close logic). */
  openClassification?: EventClassification;
}

export class Detector {
  private targets = new Map<number, TargetState>();
  private outage: OpenState | null = null;
  private lossEvent: OpenState | null = null;
  private latencyEvent: OpenState | null = null;
  private highLatencyEvent: OpenState | null = null;
  private dnsEvent: OpenState | null = null;
  private dnsConsecutiveFails = 0;
  private dnsConsecutiveOk = 0;
  /** Gateway state observed during the current outage window. */
  private outageGatewayFailed = false;
  private recentOpenTimestamps: number[] = [];

  constructor(
    private cb: DetectorCallbacks,
    private pingIntervalSec: number,
    private latencyThresholdMs: number = HIGH_LATENCY_DEFAULT_MS,
  ) {}

  /** (Re)register the probed targets. Call on start and on mode change. */
  setTargets(targets: Target[]): void {
    const keep = new Set(targets.map((t) => t.id));
    for (const id of [...this.targets.keys()]) {
      if (!keep.has(id)) this.targets.delete(id);
    }
    // ~1h worth of samples: alpha = 2 / (N + 1).
    const samplesPerHour = Math.max(10, 3600 / this.pingIntervalSec);
    for (const t of targets) {
      if (!this.targets.has(t.id)) {
        this.targets.set(t.id, {
          target: t,
          consecutiveLost: 0,
          consecutiveOk: 0,
          lossWindow: [],
          recent: [],
          baseline: new Ewma(2 / (samplesPerHour + 1)),
          spikeSince: null,
          calmSince: null,
          highSince: null,
          highCalmSince: null,
          lastRtt: null,
          lastTs: null,
          samplesUnderClosePct: 0,
        });
      } else {
        this.targets.get(t.id)!.target = t;
      }
    }
  }

  setPingInterval(sec: number): void {
    this.pingIntervalSec = sec;
  }

  /** Absolute high-latency alert threshold in ms; <=0 disables the alert. */
  setLatencyThreshold(ms: number): void {
    this.latencyThresholdMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  }

  /** WAN targets that participate in detection (custom targets excluded). */
  private wanStates(): TargetState[] {
    return [...this.targets.values()].filter(
      (s) => !s.target.isLan && s.target.enabled && s.target.kind !== 'custom',
    );
  }

  private gatewayState(): TargetState | null {
    return [...this.targets.values()].find((s) => s.target.kind === 'gateway') ?? null;
  }

  getLastRtt(targetId: number): { rtt: number | null; ts: number | null } {
    const s = this.targets.get(targetId);
    return { rtt: s?.lastRtt ?? null, ts: s?.lastTs ?? null };
  }

  getRecentLossPct(targetId: number): number {
    const s = this.targets.get(targetId);
    if (!s || s.lossWindow.length === 0) return 0;
    const lost = s.lossWindow.filter((ok) => !ok).length;
    return (lost / s.lossWindow.length) * 100;
  }

  hasOpenOutage(): boolean {
    return this.outage !== null;
  }

  hasOpenDegradation(): boolean {
    return (
      this.lossEvent !== null ||
      this.latencyEvent !== null ||
      this.highLatencyEvent !== null ||
      this.dnsEvent !== null
    );
  }

  // ------------------------------------------------------------------ pings

  onPing(sample: DetectorSample): void {
    const state = this.targets.get(sample.targetId);
    if (!state) return;

    state.lastTs = sample.ts;
    const ok = sample.rttMs !== null;
    if (ok) {
      state.lastRtt = sample.rttMs;
      state.consecutiveOk += 1;
      state.consecutiveLost = 0;
    } else {
      state.lastRtt = null;
      state.consecutiveLost += 1;
      state.consecutiveOk = 0;
    }

    state.lossWindow.push(ok);
    if (state.lossWindow.length > LOSS_CLOSE_SAMPLES) state.lossWindow.shift();

    if (ok) {
      state.recent.push({ ts: sample.ts, rtt: sample.rttMs! });
    }
    const cutoff = sample.ts - LATENCY_MEDIAN_WINDOW_MS;
    while (state.recent.length > 0 && state.recent[0]!.ts < cutoff) state.recent.shift();

    // Baseline only learns outside of anomalies, so a long spike does not
    // become the new normal too quickly.
    if (ok && this.latencyEvent === null && this.outage === null) {
      state.baseline.push(sample.rttMs!);
    }

    this.evaluateOutage(sample.ts);
    if (!state.target.isLan && state.target.kind !== 'custom') {
      this.evaluateLoss(sample.ts);
      this.evaluateLatency(state, sample.ts);
      this.evaluateHighLatency(state, sample.ts);
    }
  }

  // ------------------------------------------------------------------ DNS

  onDns(ts: number, success: boolean, durationMs: number | null): void {
    const effectiveFail = !success || (durationMs !== null && durationMs > DNS_SLOW_MS);
    if (effectiveFail) {
      this.dnsConsecutiveFails += 1;
      this.dnsConsecutiveOk = 0;
    } else {
      this.dnsConsecutiveOk += 1;
      this.dnsConsecutiveFails = 0;
    }

    if (!this.dnsEvent && this.dnsConsecutiveFails >= DNS_FAIL_COUNT && !this.outage) {
      this.dnsEvent = { startedAt: ts, detail: {} };
      this.emitOpen({
        kind: 'dns_failure',
        severity: 'minor',
        classification: 'unknown',
        startedAt: ts,
        summary: 'DNS lookups through the system resolver are failing or extremely slow',
        detail: {},
      });
    } else if (this.dnsEvent && this.dnsConsecutiveOk >= DNS_FAIL_COUNT) {
      const startedAt = this.dnsEvent.startedAt;
      this.dnsEvent = null;
      this.cb.onClose({
        kind: 'dns_failure',
        severity: this.severityFromDuration(ts - startedAt),
        classification: 'unknown',
        startedAt,
        endedAt: ts,
        summary: 'DNS resolution failed or was extremely slow',
        detail: { durationMs: ts - startedAt },
      });
    }
  }

  // --------------------------------------------------------------- helpers

  private severityFromDuration(ms: number): EventSeverity {
    if (ms < 60_000) return 'minor';
    if (ms < 10 * 60_000) return 'major';
    return 'critical';
  }

  private classifyOutage(): EventClassification {
    const gw = this.gatewayState();
    if (!gw) return 'unknown';
    if (this.outageGatewayFailed) return 'lan';
    const ispHop = this.wanStates().find((s) => s.target.kind === 'isp_hop');
    if (ispHop) {
      return ispHop.consecutiveLost >= OUTAGE_OPEN_LOSSES ? 'isp' : 'upstream';
    }
    return 'unknown';
  }

  private emitOpen(event: OpenedEvent): void {
    this.recentOpenTimestamps.push(event.startedAt);
    this.recentOpenTimestamps = this.recentOpenTimestamps.filter(
      (t) => t >= event.startedAt - SUGGEST_WINDOW_MS,
    );
    this.cb.onOpen(event);
    if (this.recentOpenTimestamps.length >= SUGGEST_EVENT_COUNT) {
      this.cb.onSuggestFullCapture(
        `${this.recentOpenTimestamps.length} problems detected in the last 30 minutes`,
      );
    } else if (event.kind === 'outage') {
      this.cb.onSuggestFullCapture('an outage is in progress');
    }
  }

  // ---------------------------------------------------------------- outage

  private evaluateOutage(ts: number): void {
    const wan = this.wanStates();
    if (wan.length === 0) return;
    const gw = this.gatewayState();

    if (!this.outage) {
      const allDown = wan.every((s) => s.consecutiveLost >= OUTAGE_OPEN_LOSSES);
      if (allDown) {
        // Backdate to the first lost ping of the shortest losing run.
        const runLengths = wan.map((s) => s.consecutiveLost);
        const minRun = Math.min(...runLengths);
        const startedAt = ts - (minRun - 1) * this.pingIntervalSec * 1000;
        this.outageGatewayFailed = gw ? gw.consecutiveLost >= OUTAGE_OPEN_LOSSES : false;
        const classification = this.classifyOutage();
        this.outage = {
          startedAt,
          detail: { targets: wan.map((s) => s.target.host) },
          openClassification: classification,
        };
        this.emitOpen({
          kind: 'outage',
          severity: 'minor',
          classification,
          startedAt,
          summary: 'Internet connection lost — no probe targets are reachable',
          detail: this.outage.detail,
        });
      }
    } else {
      // Track whether the gateway failed at any point during the outage.
      if (gw && gw.consecutiveLost >= OUTAGE_OPEN_LOSSES) this.outageGatewayFailed = true;

      const okCount = wan.filter((s) => s.consecutiveOk >= OUTAGE_CLOSE_SUCCESSES).length;
      const needed = Math.min(2, wan.length);
      if (okCount >= needed) {
        const startedAt = this.outage.startedAt;
        const detail = this.outage.detail;
        // Classify from what was observed DURING the outage — re-evaluating
        // now would look at the recovered network and always say "fine".
        const classification: EventClassification = this.outageGatewayFailed
          ? 'lan'
          : (this.outage.openClassification ?? 'unknown');
        this.outage = null;
        // ended_at = first success of the closing run.
        const endedAt = ts - (OUTAGE_CLOSE_SUCCESSES - 1) * this.pingIntervalSec * 1000;
        const durationMs = Math.max(0, endedAt - startedAt);
        this.outageGatewayFailed = false;
        this.cb.onClose({
          kind: 'outage',
          severity: this.severityFromDuration(durationMs),
          classification,
          startedAt,
          endedAt,
          summary: `Internet outage lasting ${Math.round(durationMs / 1000)}s`,
          detail: { ...detail, durationMs },
        });
      }
    }
  }

  // ----------------------------------------------------------- packet loss

  private evaluateLoss(ts: number): void {
    const wan = this.wanStates();
    if (wan.length === 0 || this.outage) return;
    const needed = Math.min(2, wan.length);

    const lossPct = (s: TargetState): number => {
      if (s.lossWindow.length < Math.min(LOSS_WINDOW, 20)) return 0; // not enough data yet
      const window = s.lossWindow.slice(-LOSS_WINDOW);
      return (window.filter((ok) => !ok).length / window.length) * 100;
    };

    if (!this.lossEvent) {
      const affected = wan.filter((s) => lossPct(s) >= LOSS_OPEN_PCT);
      if (affected.length >= needed) {
        this.lossEvent = {
          startedAt: ts,
          detail: {
            targets: affected.map((s) => ({
              host: s.target.host,
              lossPct: Math.round(lossPct(s) * 10) / 10,
            })),
          },
        };
        this.emitOpen({
          kind: 'packet_loss',
          severity: 'minor',
          classification: this.classifyDegradation(),
          startedAt: ts,
          summary: 'Sustained packet loss detected on the connection',
          detail: this.lossEvent.detail,
        });
      }
    } else {
      // Close when every WAN target's full trailing window is under 2%.
      const allCalm = wan.every((s) => {
        if (s.lossWindow.length < LOSS_CLOSE_SAMPLES) return false;
        const lost = s.lossWindow.filter((ok) => !ok).length;
        return (lost / s.lossWindow.length) * 100 < LOSS_CLOSE_PCT;
      });
      if (allCalm) {
        const startedAt = this.lossEvent.startedAt;
        const detail = this.lossEvent.detail;
        this.lossEvent = null;
        this.cb.onClose({
          kind: 'packet_loss',
          severity: this.severityFromDuration(ts - startedAt),
          classification: this.classifyDegradation(),
          startedAt,
          endedAt: ts,
          summary: 'Packet loss episode',
          detail: { ...detail, durationMs: ts - startedAt },
        });
      }
    }
  }

  /** For loss/latency events: gateway healthy implies the problem is beyond the LAN. */
  private classifyDegradation(): EventClassification {
    const gw = this.gatewayState();
    if (!gw) return 'unknown';
    const gwLoss = this.getRecentLossPct(gw.target.id);
    if (gwLoss >= LOSS_OPEN_PCT) return 'lan';
    const ispHop = this.wanStates().find((s) => s.target.kind === 'isp_hop');
    if (ispHop) return 'isp';
    return 'unknown';
  }

  // -------------------------------------------------------- latency spikes

  private evaluateLatency(state: TargetState, ts: number): void {
    const base = state.baseline.get();
    const rtts = state.recent.map((r) => r.rtt);
    const med = median(rtts);
    if (base === null || med === null || rtts.length < 5) return;

    const openThreshold = Math.max(2 * base, base + LATENCY_ABS_MARGIN_MS);
    const closeThreshold = 1.3 * base;

    if (med > openThreshold) {
      if (state.spikeSince === null) state.spikeSince = ts;
      state.calmSince = null;
    } else if (med < closeThreshold) {
      if (state.calmSince === null) state.calmSince = ts;
      state.spikeSince = null;
    } else {
      state.spikeSince = null;
    }

    const wan = this.wanStates();
    const needed = Math.min(2, wan.length);

    if (!this.latencyEvent) {
      const spiking = wan.filter(
        (s) => s.spikeSince !== null && ts - s.spikeSince >= LATENCY_SUSTAIN_MS,
      );
      if (spiking.length >= needed) {
        const startedAt = Math.min(...spiking.map((s) => s.spikeSince!));
        this.latencyEvent = {
          startedAt,
          detail: {
            targets: spiking.map((s) => ({
              host: s.target.host,
              baselineMs: Math.round((s.baseline.get() ?? 0) * 10) / 10,
              medianMs: Math.round((median(s.recent.map((r) => r.rtt)) ?? 0) * 10) / 10,
            })),
          },
        };
        this.emitOpen({
          kind: 'latency_spike',
          severity: 'minor',
          classification: this.classifyDegradation(),
          startedAt,
          summary: 'Latency is far above its normal baseline',
          detail: this.latencyEvent.detail,
        });
      }
    } else {
      const calm = wan.filter(
        (s) => s.calmSince !== null && ts - s.calmSince >= LATENCY_CLOSE_MS,
      );
      if (calm.length >= wan.length) {
        const startedAt = this.latencyEvent.startedAt;
        const detail = this.latencyEvent.detail;
        this.latencyEvent = null;
        this.cb.onClose({
          kind: 'latency_spike',
          severity: this.severityFromDuration(ts - startedAt),
          classification: this.classifyDegradation(),
          startedAt,
          endedAt: ts,
          summary: 'Latency spike episode',
          detail: { ...detail, durationMs: ts - startedAt },
        });
      }
    }
  }

  // --------------------------------------------- high latency (absolute)

  private evaluateHighLatency(state: TargetState, ts: number): void {
    const threshold = this.latencyThresholdMs;
    if (threshold <= 0) return; // disabled in settings
    const rtts = state.recent.map((r) => r.rtt);
    const med = median(rtts);
    if (med === null || rtts.length < 5) return;

    if (med > threshold) {
      if (state.highSince === null) state.highSince = ts;
      state.highCalmSince = null;
    } else if (med < HIGH_LATENCY_CLOSE_FRACTION * threshold) {
      if (state.highCalmSince === null) state.highCalmSince = ts;
      state.highSince = null;
    } else {
      state.highSince = null;
    }

    const wan = this.wanStates();
    const needed = Math.min(2, wan.length);

    if (!this.highLatencyEvent) {
      if (this.outage) return;
      const high = wan.filter(
        (s) => s.highSince !== null && ts - s.highSince >= HIGH_LATENCY_SUSTAIN_MS,
      );
      if (high.length >= needed) {
        const startedAt = Math.min(...high.map((s) => s.highSince!));
        this.highLatencyEvent = {
          startedAt,
          detail: {
            thresholdMs: threshold,
            targets: high.map((s) => ({
              host: s.target.host,
              medianMs: Math.round((median(s.recent.map((r) => r.rtt)) ?? 0) * 10) / 10,
            })),
          },
        };
        this.emitOpen({
          kind: 'high_latency',
          severity: 'minor',
          classification: this.classifyDegradation(),
          startedAt,
          summary: `Latency is above the ${threshold} ms alert threshold`,
          detail: this.highLatencyEvent.detail,
        });
      }
    } else {
      const calm = wan.filter(
        (s) => s.highCalmSince !== null && ts - s.highCalmSince >= HIGH_LATENCY_CLOSE_MS,
      );
      if (calm.length >= wan.length) {
        const startedAt = this.highLatencyEvent.startedAt;
        const detail = this.highLatencyEvent.detail;
        this.highLatencyEvent = null;
        this.cb.onClose({
          kind: 'high_latency',
          severity: this.severityFromDuration(ts - startedAt),
          classification: this.classifyDegradation(),
          startedAt,
          endedAt: ts,
          summary: `High latency episode (above ${threshold} ms)`,
          detail: { ...detail, durationMs: ts - startedAt },
        });
      }
    }
  }
}
