import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS } from '../src/config.js';
import { mergeSettings } from '../src/api/routes.js';
import { esc } from '../src/api/reportHtml.js';
import { csvEscape } from '../src/api/reports.js';

const base = structuredClone(DEFAULT_SETTINGS);

test('mergeSettings accepts a full valid settings object', () => {
  const r = mergeSettings(base, {
    mode: 'normal',
    theme: 'light',
    speedtestDownUrl: 'https://speed.cloudflare.com/__down',
    speedtestUpUrl: 'https://speed.cloudflare.com/__up',
    speedDegradationFraction: 0.6,
    latencyThresholdMs: 0,
    retentionPingDays: 30,
    retentionDnsHttpDays: 60,
    plan: { ispName: 'Northwestel', downMbps: 250, upMbps: 100, pricePerMonth: 129, currency: 'CAD' },
  });
  assert.ok('next' in r);
  assert.equal(r.next.theme, 'light');
  assert.equal(r.next.retentionPingDays, 30);
  assert.equal(r.next.plan.downMbps, 250);
});

test('mergeSettings ignores mode (scheduler-owned)', () => {
  const r = mergeSettings({ ...base, mode: 'eco' }, { mode: 'full' });
  assert.ok('next' in r);
  assert.equal(r.next.mode, 'eco');
});

test('mergeSettings rejects non-http(s) speedtest URLs', () => {
  for (const bad of ['file:///etc/passwd', 'ftp://x/y', 'not a url', 42, null]) {
    const r = mergeSettings(base, { speedtestDownUrl: bad });
    assert.ok('error' in r, `expected rejection for ${String(bad)}`);
  }
  const ok = mergeSettings(base, { speedtestUpUrl: 'http://127.0.0.1:9000/up' });
  assert.ok('next' in ok);
});

test('mergeSettings rejects unknown keys', () => {
  const r = mergeSettings(base, { retentoinPingDays: 30 });
  assert.ok('error' in r && r.error.includes('unknown setting'));
  const p = mergeSettings(base, { plan: { ispNaem: 'x' } });
  assert.ok('error' in p && p.error.includes('unknown plan setting'));
});

test('mergeSettings enforces numeric bounds', () => {
  assert.ok('error' in mergeSettings(base, { retentionPingDays: -5 }));
  assert.ok('error' in mergeSettings(base, { retentionPingDays: 0 }));
  assert.ok('error' in mergeSettings(base, { retentionPingDays: Number.NaN }));
  assert.ok('error' in mergeSettings(base, { speedDegradationFraction: 0 }));
  assert.ok('error' in mergeSettings(base, { speedDegradationFraction: 1.5 }));
  assert.ok('error' in mergeSettings(base, { latencyThresholdMs: -1 }));
  assert.ok('error' in mergeSettings(base, { latencyThresholdMs: '120' }));
  assert.ok('next' in mergeSettings(base, { latencyThresholdMs: 120 }));
});

test('mergeSettings validates plan fields and allows nulls', () => {
  const ok = mergeSettings(base, { plan: { downMbps: null, pricePerMonth: null } });
  assert.ok('next' in ok);
  assert.equal(ok.next.plan.downMbps, null);
  assert.ok('error' in mergeSettings(base, { plan: { downMbps: 'fast' } }));
  assert.ok('error' in mergeSettings(base, { plan: { ispName: 'x'.repeat(201) } }));
  assert.ok('error' in mergeSettings(base, { plan: 'Northwestel' }));
});

test('mergeSettings does not mutate the current settings object', () => {
  const current = structuredClone(base);
  mergeSettings(current, { plan: { ispName: 'Other ISP' }, theme: 'light' });
  assert.deepEqual(current, base);
});

test('esc escapes all HTML metacharacters including quotes', () => {
  assert.equal(esc(`<img src="x" onerror='alert(1)'>&`), '&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;');
});

test('csvEscape neutralizes leading formula triggers on strings only', () => {
  assert.equal(csvEscape('=1+2'), "'=1+2");
  assert.equal(csvEscape('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvEscape('+x'), "'+x");
  assert.equal(csvEscape('-x'), "'-x");
  assert.equal(csvEscape(-5), '-5'); // numbers keep their sign
  assert.equal(csvEscape('plain'), 'plain');
  assert.equal(csvEscape('say "hi", ok'), '"say ""hi"", ok"');
});
