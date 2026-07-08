import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { Target } from '../../shared/types.js';
import { Detector, type ClosedEvent, type OpenedEvent } from '../src/monitor/detector.js';

const GATEWAY: Target = { id: 1, kind: 'gateway', host: '192.168.1.1', label: 'Router', isLan: true, enabled: true };
const ISP_HOP: Target = { id: 2, kind: 'isp_hop', host: '203.0.113.1', label: 'ISP hop', isLan: false, enabled: true };
const ANCHOR_A: Target = { id: 3, kind: 'anchor', host: '1.1.1.1', label: 'Cloudflare', isLan: false, enabled: true };
const ANCHOR_B: Target = { id: 4, kind: 'anchor', host: '8.8.8.8', label: 'Google', isLan: false, enabled: true };
const ALL = [GATEWAY, ISP_HOP, ANCHOR_A, ANCHOR_B];
const WAN_IDS = [2, 3, 4];
const INTERVAL_SEC = 1;

let opened: OpenedEvent[] = [];
let closed: ClosedEvent[] = [];
let suggestions: string[] = [];

function makeDetector(): Detector {
  opened = [];
  closed = [];
  suggestions = [];
  const d = new Detector(
    {
      onOpen: (e) => opened.push(e),
      onClose: (e) => closed.push(e),
      onSuggestFullCapture: (r) => suggestions.push(r),
    },
    INTERVAL_SEC,
  );
  d.setTargets(ALL);
  return d;
}

/** Feed one synthetic round of pings (all targets) at time t. null = lost. */
function round(d: Detector, t: number, rtt: Record<number, number | null>): void {
  for (const target of ALL) {
    const rttMs = target.id in rtt ? rtt[target.id]! : 20;
    d.onPing({ ts: t, targetId: target.id, rttMs });
  }
}

/** N healthy rounds starting at t0, 1s apart. Returns next timestamp. */
function healthy(d: Detector, t0: number, n: number): number {
  for (let i = 0; i < n; i++) round(d, t0 + i * 1000, {});
  return t0 + n * 1000;
}

beforeEach(() => {
  opened = [];
  closed = [];
});

test('outage opens after 3 consecutive losses on all WAN targets, classified isp when gateway is fine', () => {
  const d = makeDetector();
  let t = healthy(d, 0, 30);

  for (let i = 0; i < 3; i++) {
    round(d, t + i * 1000, { 2: null, 3: null, 4: null }); // gateway still replies
  }
  const e = opened.find((ev) => ev.kind === 'outage');
  assert.ok(e, 'outage opened');
  assert.equal(e!.classification, 'isp');
  // Backdated to the first lost ping.
  assert.equal(e!.startedAt, t);
});

test('outage classified lan when the gateway is also down', () => {
  const d = makeDetector();
  const t = healthy(d, 0, 30);
  for (let i = 0; i < 3; i++) {
    round(d, t + i * 1000, { 1: null, 2: null, 3: null, 4: null });
  }
  const e = opened.find((ev) => ev.kind === 'outage');
  assert.ok(e, 'outage opened');
  assert.equal(e!.classification, 'lan');
});

test('outage closes after 3 consecutive successes on >=2 WAN targets, with correct end time', () => {
  const d = makeDetector();
  let t = healthy(d, 0, 30);
  for (let i = 0; i < 5; i++) round(d, t + i * 1000, { 2: null, 3: null, 4: null });
  t += 5000;
  assert.ok(opened.some((e) => e.kind === 'outage'));
  assert.equal(closed.filter((e) => e.kind === 'outage').length, 0);

  for (let i = 0; i < 3; i++) round(d, t + i * 1000, {});
  const e = closed.find((c) => c.kind === 'outage');
  assert.ok(e, 'outage closed');
  // ended_at = first success of the closing run = t.
  assert.equal(e!.endedAt, t);
  assert.ok(e!.endedAt - e!.startedAt >= 4000);
  // Classification reflects what was observed DURING the outage (gateway ok,
  // ISP hop dead => isp), not the recovered network at close time.
  assert.equal(e!.classification, 'isp');
});

test('no outage when only one anchor fails', () => {
  const d = makeDetector();
  const t = healthy(d, 0, 30);
  for (let i = 0; i < 10; i++) round(d, t + i * 1000, { 3: null });
  assert.equal(opened.filter((e) => e.kind === 'outage').length, 0);
});

test('packet loss event opens on sustained >=5% loss across >=2 WAN targets and closes when calm', () => {
  const d = makeDetector();
  let t = healthy(d, 0, 60);
  // 10% loss pattern on both anchors + isp hop for 60 rounds.
  for (let i = 0; i < 60; i++) {
    const lose = i % 10 === 0;
    round(d, t + i * 1000, lose ? { 2: null, 3: null, 4: null } : {});
  }
  t += 60_000;
  assert.ok(opened.some((e) => e.kind === 'packet_loss'), 'loss event opened');

  // 120 clean rounds close it.
  t = healthy(d, t, 121);
  assert.ok(closed.some((e) => e.kind === 'packet_loss'), 'loss event closed');
});

test('latency spike opens when median doubles vs baseline and closes on recovery', () => {
  const d = makeDetector();
  // Build a ~20ms baseline over 10 minutes of 1s samples.
  let t = healthy(d, 0, 600);
  // Now 90s of 200ms latency on all WAN targets.
  for (let i = 0; i < 90; i++) {
    round(d, t + i * 1000, { 2: 200, 3: 200, 4: 200 });
  }
  t += 90_000;
  const spike = opened.find((e) => e.kind === 'latency_spike');
  assert.ok(spike, 'latency spike opened');

  // Recovery: back to 20ms for 3 minutes.
  t = healthy(d, t, 180);
  assert.ok(closed.some((e) => e.kind === 'latency_spike'), 'latency spike closed');
});

test('high latency opens when median exceeds the default 120ms threshold and closes on recovery', () => {
  const d = makeDetector();
  let t = healthy(d, 0, 60);
  // 90s of 150ms RTT on all WAN targets (above the 120ms default). The
  // rolling 60s median crosses the threshold ~30s in, then must sustain 30s.
  for (let i = 0; i < 90; i++) {
    round(d, t + i * 1000, { 2: 150, 3: 150, 4: 150 });
  }
  t += 90_000;
  const e = opened.find((ev) => ev.kind === 'high_latency');
  assert.ok(e, 'high latency opened');
  assert.equal((e!.detail as { thresholdMs: number }).thresholdMs, 120);

  // Recovery: back to 20ms for 3 minutes.
  t = healthy(d, t, 180);
  assert.ok(closed.some((ev) => ev.kind === 'high_latency'), 'high latency closed');
});

test('no high latency event while the median stays under the threshold', () => {
  const d = makeDetector();
  const t = healthy(d, 0, 60);
  for (let i = 0; i < 120; i++) {
    round(d, t + i * 1000, { 2: 100, 3: 100, 4: 100 });
  }
  assert.equal(opened.filter((e) => e.kind === 'high_latency').length, 0);
});

test('high latency threshold is settable and 0 disables the alert', () => {
  const d = makeDetector();
  d.setLatencyThreshold(200);
  let t = healthy(d, 0, 60);
  for (let i = 0; i < 120; i++) {
    round(d, t + i * 1000, { 2: 150, 3: 150, 4: 150 });
  }
  t += 120_000;
  assert.equal(opened.filter((e) => e.kind === 'high_latency').length, 0, '150ms under a 200ms threshold');

  for (let i = 0; i < 90; i++) {
    round(d, t + i * 1000, { 2: 250, 3: 250, 4: 250 });
  }
  t += 90_000;
  assert.ok(opened.some((e) => e.kind === 'high_latency'), '250ms over a 200ms threshold');

  const d2 = makeDetector();
  d2.setLatencyThreshold(0);
  const t2 = healthy(d2, 0, 60);
  for (let i = 0; i < 120; i++) {
    round(d2, t2 + i * 1000, { 2: 500, 3: 500, 4: 500 });
  }
  assert.equal(opened.filter((e) => e.kind === 'high_latency').length, 0, 'disabled with 0');
});

test('high latency fires in eco mode (30s ping interval), where a fixed 60s window would starve the median', () => {
  // Regression: the latency median window must widen for slow ping modes.
  // At a 30s interval a fixed 60s window holds only ~2 samples — below the
  // 5-sample minimum — so latency detection used to never fire in eco mode.
  const d = new Detector(
    {
      onOpen: (e) => opened.push(e),
      onClose: (e) => closed.push(e),
      onSuggestFullCapture: () => {},
    },
    30,
  );
  d.setTargets([GATEWAY, ANCHOR_A, ANCHOR_B]);
  let t = 0;
  // 1 hour healthy at 30s spacing.
  for (let i = 0; i < 120; i++) {
    d.onPing({ ts: t, targetId: 1, rttMs: 3 });
    d.onPing({ ts: t, targetId: 3, rttMs: 20 });
    d.onPing({ ts: t, targetId: 4, rttMs: 22 });
    t += 30_000;
  }
  // 30 minutes of 300ms on both anchors (well above the 120ms default).
  for (let i = 0; i < 60; i++) {
    d.onPing({ ts: t, targetId: 1, rttMs: 3 });
    d.onPing({ ts: t, targetId: 3, rttMs: 300 });
    d.onPing({ ts: t, targetId: 4, rttMs: 300 });
    t += 30_000;
  }
  assert.ok(opened.some((e) => e.kind === 'high_latency'), 'high latency opened in eco mode');
});

test('dns failure opens after 2 consecutive failures and closes after 2 successes', () => {
  const d = makeDetector();
  healthy(d, 0, 10);
  d.onDns(20_000, false, null);
  d.onDns(21_000, false, null);
  assert.ok(opened.some((e) => e.kind === 'dns_failure'));
  d.onDns(22_000, true, 30);
  d.onDns(23_000, true, 25);
  assert.ok(closed.some((e) => e.kind === 'dns_failure'));
});

test('slow DNS (>2s) counts as failure', () => {
  const d = makeDetector();
  d.onDns(1000, true, 2500);
  d.onDns(2000, true, 3000);
  assert.ok(opened.some((e) => e.kind === 'dns_failure'));
});

test('critical outage triggers a Full Capture suggestion', () => {
  const d = makeDetector();
  const t = healthy(d, 0, 30);
  for (let i = 0; i < 3; i++) round(d, t + i * 1000, { 2: null, 3: null, 4: null });
  assert.ok(suggestions.length >= 1, 'suggestion emitted for outage');
});

test('eco mode (single WAN target) still detects outages', () => {
  const d = new Detector(
    {
      onOpen: (e) => opened.push(e),
      onClose: (e) => closed.push(e),
      onSuggestFullCapture: () => {},
    },
    30,
  );
  d.setTargets([GATEWAY, ANCHOR_A]);
  let t = 0;
  for (let i = 0; i < 20; i++) {
    d.onPing({ ts: t, targetId: 1, rttMs: 1 });
    d.onPing({ ts: t, targetId: 3, rttMs: 25 });
    t += 30_000;
  }
  for (let i = 0; i < 3; i++) {
    d.onPing({ ts: t, targetId: 1, rttMs: 1 });
    d.onPing({ ts: t, targetId: 3, rttMs: null });
    t += 30_000;
  }
  assert.ok(opened.some((e) => e.kind === 'outage'));
});
