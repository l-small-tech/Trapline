/**
 * Simplified ITU-T G.107 E-model → MOS estimate.
 *
 * R = 93.2 − Id − Ie
 *   Id (delay impairment)  = 0.024·d + 0.11·(d − 177.3)·H(d − 177.3)
 *       where d = one-way delay ≈ (RTT p50)/2 + jitter/2, H = step function
 *   Ie (loss impairment)   = 30·ln(1 + 15·loss_fraction)
 *
 * R → MOS via the standard cubic:
 *   MOS = 1 + 0.035·R + 7e-6·R·(R − 60)·(100 − R), clamped to [1, 5]
 *
 * This is the same formula printed in the report methodology appendix —
 * keep them in sync.
 */
export function mosFromMetrics(
  rttP50Ms: number | null,
  jitterMs: number | null,
  lossFraction: number,
): number | null {
  if (rttP50Ms === null) return null;
  const d = rttP50Ms / 2 + (jitterMs ?? 0) / 2;
  const id = 0.024 * d + (d > 177.3 ? 0.11 * (d - 177.3) : 0);
  const ie = 30 * Math.log(1 + 15 * Math.max(0, lossFraction));
  const r = Math.max(0, Math.min(100, 93.2 - id - ie));
  const mos = 1 + 0.035 * r + 7e-6 * r * (r - 60) * (100 - r);
  return Math.max(1, Math.min(5, Math.round(mos * 100) / 100));
}
