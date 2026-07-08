import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decimateMinMax, Ewma, jitter, median, percentile } from '../src/util/stats.js';
import { mosFromMetrics } from '../src/util/mos.js';

test('percentile: empty, single, interpolation', () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([10], 0.5), 10);
  assert.equal(percentile([0, 10], 0.5), 5);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(percentile([1, 2, 3, 4, 5], 1), 5);
  assert.equal(percentile([1, 2, 3, 4, 5], 0), 1);
});

test('median sorts its input copy', () => {
  const arr = [5, 1, 3];
  assert.equal(median(arr), 3);
  assert.deepEqual(arr, [5, 1, 3]); // untouched
});

test('jitter is mean absolute consecutive difference', () => {
  assert.equal(jitter([10]), null);
  assert.equal(jitter([10, 20, 10]), 10);
  assert.equal(jitter([5, 5, 5, 5]), 0);
});

test('EWMA converges toward pushed values', () => {
  const e = new Ewma(0.5);
  assert.equal(e.get(), null);
  e.push(10);
  assert.equal(e.get(), 10);
  e.push(20);
  assert.equal(e.get(), 15);
});

test('decimateMinMax preserves extremes and nulls (losses)', () => {
  const points = Array.from({ length: 1000 }, (_, i) => ({
    ts: i * 1000,
    value: i === 500 ? 999 : (10 + (i % 5)) as number | null,
  }));
  points[700] = { ts: 700_000, value: null }; // one lost sample
  const out = decimateMinMax(points, 100);
  assert.ok(out.length <= 300); // min+max+null per bucket at most
  assert.ok(out.some((p) => p.value === 999), 'spike survives decimation');
  assert.ok(out.some((p) => p.value === null), 'loss survives decimation');
  // still time-ordered
  for (let i = 1; i < out.length; i++) assert.ok(out[i]!.ts >= out[i - 1]!.ts);
});

test('decimateMinMax passes small inputs through', () => {
  const points = [{ ts: 1, value: 2 }];
  assert.deepEqual(decimateMinMax(points, 100), points);
});

test('MOS: excellent line scores high, lossy line scores low', () => {
  const good = mosFromMetrics(20, 2, 0)!;
  assert.ok(good > 4.2, `expected >4.2, got ${good}`);
  const lossy = mosFromMetrics(80, 20, 0.05)!;
  assert.ok(lossy < 4.0 && lossy > 2.5, `expected 2.5–4.0, got ${lossy}`);
  assert.ok(lossy < good, 'lossy line scores below the clean line');
  const awful = mosFromMetrics(500, 100, 0.2)!;
  assert.ok(awful < 2, `expected <2, got ${awful}`);
  assert.equal(mosFromMetrics(null, null, 0), null);
});
