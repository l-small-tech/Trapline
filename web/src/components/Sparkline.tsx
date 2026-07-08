import { useEffect, useRef } from 'react';
import { cssVar } from '../hooks/useTheme';

/**
 * Tiny dependency-free canvas sparkline. Lost samples (null) are drawn as
 * short marks at the baseline in the critical color so outages are visible
 * even at sparkline scale.
 */
export function Sparkline({
  points,
  width = 160,
  height = 36,
  color = '--series-1',
}: {
  points: (number | null)[];
  width?: number;
  height?: number;
  /** CSS var name for the line color. */
  color?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    if (points.length < 2) return;

    const values = points.filter((p): p is number => p !== null);
    const max = values.length ? Math.max(...values) : 1;
    const min = values.length ? Math.min(...values) : 0;
    const span = max - min || 1;
    const x = (i: number) => (i / (points.length - 1)) * (width - 2) + 1;
    const y = (v: number) => height - 4 - ((v - min) / span) * (height - 10);

    ctx.strokeStyle = cssVar(color) || '#3987e5';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    points.forEach((p, i) => {
      if (p === null) {
        started = false;
        return;
      }
      if (!started) {
        ctx.moveTo(x(i), y(p));
        started = true;
      } else {
        ctx.lineTo(x(i), y(p));
      }
    });
    ctx.stroke();

    // Losses at the baseline.
    ctx.fillStyle = cssVar('--critical') || '#d03b3b';
    points.forEach((p, i) => {
      if (p === null) ctx.fillRect(x(i) - 1, height - 3, 2, 3);
    });
  }, [points, width, height, color]);

  return <canvas ref={ref} style={{ width, height }} aria-hidden="true" />;
}
