/** Statistics helpers shared by the detector, rollups, and reports. */

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (idx - lo);
}

export function median(values: number[]): number | null {
  return percentile([...values].sort((a, b) => a - b), 0.5);
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Mean absolute difference between consecutive RTTs (RFC 3550-style jitter). */
export function jitter(rtts: number[]): number | null {
  if (rtts.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < rtts.length; i++) sum += Math.abs(rtts[i]! - rtts[i - 1]!);
  return sum / (rtts.length - 1);
}

/** Exponentially weighted moving average. */
export class Ewma {
  private value: number | null = null;
  constructor(private alpha: number) {}

  push(v: number): number {
    this.value = this.value === null ? v : this.alpha * v + (1 - this.alpha) * this.value;
    return this.value;
  }

  get(): number | null {
    return this.value;
  }
}

export interface TimeValue {
  ts: number;
  value: number | null;
}

/**
 * Min/max bucket decimation for charting: reduces `points` to at most
 * `maxPoints` while preserving spikes (each bucket contributes its min and
 * max, and any null (lost sample) in a bucket is kept so outages stay
 * visible).
 */
export function decimateMinMax(points: TimeValue[], maxPoints: number): TimeValue[] {
  if (points.length <= maxPoints || maxPoints < 4) return points;
  const bucketCount = Math.floor(maxPoints / 2);
  const bucketSize = Math.ceil(points.length / bucketCount);
  const out: TimeValue[] = [];
  for (let b = 0; b < bucketCount; b++) {
    const slice = points.slice(b * bucketSize, (b + 1) * bucketSize);
    if (slice.length === 0) continue;
    let minP: TimeValue | null = null;
    let maxP: TimeValue | null = null;
    let nullP: TimeValue | null = null;
    for (const p of slice) {
      if (p.value === null) {
        if (!nullP) nullP = p;
        continue;
      }
      if (!minP || p.value < minP.value!) minP = p;
      if (!maxP || p.value > maxP.value!) maxP = p;
    }
    const picks = [minP, maxP, nullP].filter((p): p is TimeValue => p !== null);
    picks.sort((a, b2) => a.ts - b2.ts);
    // De-dupe (min and max may be the same sample).
    for (const p of picks) {
      if (out.length === 0 || out[out.length - 1] !== p) out.push(p);
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}
