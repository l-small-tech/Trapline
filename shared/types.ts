/**
 * Shared DTO types used by both the Trapline server and the web UI.
 * All timestamps are UTC epoch milliseconds unless noted otherwise.
 */

export type Mode = 'eco' | 'normal' | 'full';

export type TargetKind = 'gateway' | 'isp_hop' | 'anchor' | 'custom';

export interface Target {
  id: number;
  kind: TargetKind;
  host: string;
  label: string;
  isLan: boolean;
  enabled: boolean;
}

export type ConnectionState = 'up' | 'degraded' | 'down';

export type EventKind =
  | 'outage'
  | 'latency_spike'
  | 'packet_loss'
  | 'dns_failure'
  | 'speed_degradation'
  | 'monitor_gap';

export type EventSeverity = 'info' | 'minor' | 'major' | 'critical';

/** Who is at fault, as best we can tell. Crucial for evidence credibility. */
export type EventClassification = 'isp' | 'lan' | 'upstream' | 'unknown';

export interface MonitorEvent {
  id: number;
  kind: EventKind;
  severity: EventSeverity;
  classification: EventClassification;
  startedAt: number;
  endedAt: number | null; // null = ongoing
  summary: string;
  detail: Record<string, unknown>;
}

export type EvidenceKind = 'mtr' | 'ping_window' | 'dns_log' | 'speed';

export interface EventEvidence {
  id: number;
  eventId: number;
  kind: EvidenceKind;
  capturedAt: number;
  content: unknown;
}

export interface TargetLive {
  target: Target;
  lastRttMs: number | null;
  lastSampleAt: number | null;
  /** Loss % over the trailing 60 samples. */
  recentLossPct: number;
}

export interface StatusSnapshot {
  state: ConnectionState;
  stateSince: number;
  mode: Mode;
  /** When Full Capture auto-reverts to normal (epoch ms), if scheduled. */
  revertAt: number | null;
  targets: TargetLive[];
  openEvents: MonitorEvent[];
  mtrAvailable: boolean;
  serverStartedAt: number;
  version: string;
}

export interface PingPoint {
  ts: number;
  targetId: number;
  rttMs: number | null; // null = lost
}

export interface DnsPoint {
  ts: number;
  resolver: string;
  hostname: string;
  durationMs: number | null;
  success: boolean;
  error: string | null;
}

export interface HttpPoint {
  ts: number;
  url: string;
  status: number | null;
  ttfbMs: number | null;
  totalMs: number | null;
  success: boolean;
  error: string | null;
}

export type BufferbloatGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface SpeedTestResult {
  id: number;
  ts: number;
  trigger: 'scheduled' | 'manual';
  downBps: number | null;
  upBps: number | null;
  idleLatencyMs: number | null;
  loadedDownMs: number | null;
  loadedUpMs: number | null;
  bufferbloatGrade: BufferbloatGrade | null;
  bytesDown: number;
  bytesUp: number;
  durationMs: number;
  error: string | null;
}

export interface SpeedTestProgress {
  phase: 'idle_latency' | 'preflight' | 'download' | 'upload' | 'done' | 'error';
  /** Instantaneous throughput estimate for the active phase, bits/sec. */
  currentBps: number;
  elapsedMs: number;
  message?: string;
}

export interface PingRollup {
  hourStart: number;
  targetId: number;
  sent: number;
  lost: number;
  rttAvg: number | null;
  rttMin: number | null;
  rttMax: number | null;
  rttP50: number | null;
  rttP95: number | null;
  rttP99: number | null;
  jitterAvg: number | null;
}

export type UsageCategory = 'ping' | 'dns' | 'http' | 'speedtest' | 'mtr';

export interface UsageBucket {
  bucketStart: number;
  category: UsageCategory;
  isLan: boolean;
  bytesSent: number;
  bytesRecv: number;
}

export interface UsageSummary {
  lifetimeBytes: number;
  buckets: UsageBucket[];
  /** Estimated bytes/month for each mode given current settings + recent speed-test sizes. */
  projections: Record<Mode, number>;
}

export interface PlanSettings {
  ispName: string;
  downMbps: number | null;
  upMbps: number | null;
  pricePerMonth: number | null;
  currency: string;
}

export interface Settings {
  mode: Mode;
  plan: PlanSettings;
  theme: 'dark' | 'light';
  /** Speed-test endpoints; defaults are Cloudflare but user-overridable. */
  speedtestDownUrl: string;
  speedtestUpUrl: string;
  /** Measured-below-this-fraction of the advertised plan raises a speed_degradation event. */
  speedDegradationFraction: number;
  retentionPingDays: number;
  retentionDnsHttpDays: number;
}

export interface SummaryStats {
  from: number;
  to: number;
  /** Fraction of the range the monitor was actually running. */
  coveragePct: number;
  uptimePct: number;
  outageCount: number;
  outageTotalMs: number;
  lossPct: number;
  latencyP50: number | null;
  latencyP95: number | null;
  jitterAvg: number | null;
  mos: number | null;
  speedTests: number;
  avgDownBps: number | null;
  avgUpBps: number | null;
  events: MonitorEvent[];
}

export interface DnsBenchResult {
  resolver: string;
  label: string;
  medianMs: number | null;
  successPct: number;
  samples: { hostname: string; durationMs: number | null; success: boolean }[];
}

export interface MtrHop {
  hop: number;
  host: string;
  ip: string;
  lossPct: number;
  sent: number;
  last: number;
  avg: number;
  best: number;
  worst: number;
  stdev: number;
}

export interface MtrResult {
  target: string;
  capturedAt: number;
  hops: MtrHop[];
}

export interface HealthCheckResult {
  ranAt: number;
  ping: { host: string; label: string; medianRttMs: number | null; lossPct: number }[];
  dns: { ok: boolean; durationMs: number | null; error: string | null };
  http: { url: string; ok: boolean; ttfbMs: number | null; error: string | null };
  verdict: 'good' | 'degraded' | 'bad';
  explanation: string;
}

/** Messages pushed over the SSE stream (/trapline/api/live). */
export type SseMessage =
  | { type: 'samples'; data: { ping: PingPoint[]; dns: DnsPoint[]; http: HttpPoint[] } }
  | { type: 'event'; data: { action: 'opened' | 'updated' | 'closed'; event: MonitorEvent } }
  | { type: 'status'; data: StatusSnapshot }
  | { type: 'speedtest'; data: { progress?: SpeedTestProgress; result?: SpeedTestResult } }
  | { type: 'suggestion'; data: { suggest: 'full'; reason: string } };
