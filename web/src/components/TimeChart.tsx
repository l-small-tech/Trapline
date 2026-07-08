import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { cssVar } from '../hooks/useTheme';

export interface ChartSeries {
  label: string;
  /** CSS var name, e.g. '--series-1'. */
  colorVar: string;
  unit?: string;
  dash?: number[];
  /** Draw points instead of a line (used for loss markers). */
  pointsOnly?: boolean;
}

/**
 * uPlot wrapper: canvas rendering (handles 100k+ points), crosshair +
 * built-in legend as the hover layer, theme-aware chrome, container-width
 * responsive.
 */
export function TimeChart({
  data,
  series,
  height = 260,
  yUnit = '',
}: {
  data: uPlot.AlignedData;
  series: ChartSeries[];
  height?: number;
  yUnit?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  const opts = useMemo((): uPlot.Options => {
    const axisColor = cssVar('--muted');
    const gridColor = cssVar('--grid');
    return {
      width: 600,
      height,
      cursor: { points: { size: 7 } },
      legend: { live: true },
      scales: { x: { time: true } },
      axes: [
        {
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor, width: 1 },
        },
        {
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor, width: 1 },
          values: (_u, ticks) => ticks.map((t) => `${t}${yUnit}`),
          size: 56,
        },
      ],
      series: [
        {},
        ...series.map((s) => ({
          label: s.label,
          stroke: s.pointsOnly ? undefined : cssVar(s.colorVar),
          width: s.pointsOnly ? 0 : 2,
          dash: s.dash,
          spanGaps: false,
          points: s.pointsOnly
            ? { show: true, size: 6, fill: cssVar(s.colorVar), stroke: cssVar(s.colorVar) }
            : { show: false },
          value: (_u: uPlot, v: number | null) =>
            v === null ? '—' : `${Math.round(v * 10) / 10}${s.unit ?? yUnit}`,
        })),
      ],
    };
  }, [series, height, yUnit]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const plot = new uPlot(opts, data, wrap);
    plotRef.current = plot;
    const resize = () => plot.setSize({ width: wrap.clientWidth, height });
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
    // Recreate on option identity change (theme/series set), not on data ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts]);

  useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  return <div ref={wrapRef} className="uplot-wrap" />;
}
