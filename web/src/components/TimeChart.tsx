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

const WHEEL_ZOOM_FACTOR = 0.75;

/**
 * Scroll-wheel zoom on the x axis, centered on the cursor. Drag-select zoom
 * is uPlot's default; double-click resets. `onZoomChange` reports whether
 * the user is currently zoomed in, so data updates can preserve the view.
 */
function wheelZoomPlugin(onZoomChange: (zoomed: boolean) => void): uPlot.Plugin {
  return {
    hooks: {
      setSelect: [(u) => {
        if (u.select.width > 0) onZoomChange(true);
      }],
      ready: [(u) => {
        u.over.addEventListener('dblclick', () => onZoomChange(false));
        u.over.addEventListener(
          'wheel',
          (e) => {
            e.preventDefault();
            const xs = u.data[0];
            if (!xs || xs.length < 2) return;
            const dataMin = xs[0]!;
            const dataMax = xs[xs.length - 1]!;
            const { min, max } = u.scales.x!;
            if (min == null || max == null) return;
            const cursorVal =
              u.cursor.left != null && u.cursor.left >= 0
                ? u.posToVal(u.cursor.left, 'x')
                : (min + max) / 2;
            const oldRange = max - min;
            const newRange =
              e.deltaY < 0 ? oldRange * WHEEL_ZOOM_FACTOR : oldRange / WHEEL_ZOOM_FACTOR;
            let newMin = cursorVal - ((cursorVal - min) / oldRange) * newRange;
            let newMax = newMin + newRange;
            if (newMin < dataMin) {
              newMin = dataMin;
              newMax = Math.min(dataMax, newMin + newRange);
            }
            if (newMax > dataMax) {
              newMax = dataMax;
              newMin = Math.max(dataMin, newMax - newRange);
            }
            if (newMax - newMin >= dataMax - dataMin) {
              onZoomChange(false);
              u.setScale('x', { min: dataMin, max: dataMax });
            } else {
              onZoomChange(true);
              u.setScale('x', { min: newMin, max: newMax });
            }
          },
          { passive: false },
        );
      }],
    },
  };
}

/**
 * uPlot wrapper: canvas rendering (handles 100k+ points), crosshair +
 * built-in legend as the hover layer, theme-aware chrome, container-width
 * responsive. Drag or scroll to zoom the x axis; double-click to reset.
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
  // While the user is zoomed in, live data updates must not reset the view.
  const zoomedRef = useRef(false);

  const opts = useMemo((): uPlot.Options => {
    const axisColor = cssVar('--muted');
    const gridColor = cssVar('--grid');
    return {
      width: 600,
      height,
      cursor: { points: { size: 7 } },
      legend: { live: true },
      scales: { x: { time: true } },
      plugins: [
        wheelZoomPlugin((zoomed) => {
          zoomedRef.current = zoomed;
        }),
      ],
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
    zoomedRef.current = false;
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
    plotRef.current?.setData(data, !zoomedRef.current);
  }, [data]);

  return (
    <div>
      <div ref={wrapRef} className="uplot-wrap" />
      <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
        drag or scroll to zoom · double-click to reset
      </div>
    </div>
  );
}
