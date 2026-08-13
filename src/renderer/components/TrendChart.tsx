import React, { useState } from 'react';
import { cn, formatDate } from '@/lib/utils';

export interface TrendPoint {
  date: string;
  value: number;
  deviceSerial?: string;
}

interface TrendChartProps {
  points: TrendPoint[];
  unit?: string;
  // What's plotted on the Y axis (e.g. "Voltage", "Impedance") — shown in the
  // legend so the diagram states its own dimensions rather than relying on
  // surrounding page context (#154).
  label?: string;
  // Tailwind text-color class applied to the wrapping element; the SVG
  // strokes/fills with currentColor so it follows that class and the
  // light/dark theme automatically.
  className?: string;
}

const round = (v: number) => Math.round(v * 100) / 100;

// Minimal, dependency-free SVG line chart. Renders a value-over-time trend for
// a single numeric field (e.g. battery voltage, lead impedance) across visits.
// X position is proportional to actual elapsed time between visits (not just
// point index), so an uneven follow-up schedule reads correctly.
const TrendChart: React.FC<TrendChartProps> = ({ points, unit, label, className = 'text-primary' }) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);

  if (points.length < 2) return null;

  const activeIndex = hoverIndex ?? pinnedIndex;

  const width = 300;
  const height = 90;
  const marginX = 10;
  const marginY = 12;

  const times = points.map(p => new Date(p.date).getTime());
  const values = points.map(p => p.value);

  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const timeRange = maxT - minT || 1;

  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const valueRange = maxV - minV;
  const yPad = valueRange > 0 ? valueRange * 0.15 : Math.max(Math.abs(minV) * 0.1, 1);

  const toX = (t: number) => marginX + ((t - minT) / timeRange) * (width - 2 * marginX);
  const toY = (v: number) => {
    const lo = minV - yPad;
    const hi = maxV + yPad;
    return height - marginY - ((v - lo) / (hi - lo)) * (height - 2 * marginY);
  };

  const coords = points.map(p => ({ x: toX(new Date(p.date).getTime()), y: toY(p.value), point: p }));

  // Split into per-device segments so a generator change never draws as one
  // continuous trend across two different batteries (#154) — a fresh
  // battery's higher voltage would otherwise read as "voltage increased",
  // which is physically implausible and misleading. Only break when BOTH
  // neighboring points have a known, differing device serial; a missing
  // serial (older/legacy data) never fragments the line on its own.
  const segmentList: (typeof coords)[] = [];
  let current: typeof coords = [];
  const breaks: { atIndex: number }[] = [];
  coords.forEach((c, idx) => {
    if (idx > 0) {
      const prev = coords[idx - 1].point;
      if (prev.deviceSerial && c.point.deviceSerial && prev.deviceSerial !== c.point.deviceSerial) {
        segmentList.push(current);
        current = [];
        breaks.push({ atIndex: idx });
      }
    }
    current.push(c);
  });
  segmentList.push(current);

  // Y axis: three gridlines/labels spanning the actual data range (not the
  // padded plot range), matching the "Range: min – max" legend below.
  const yTicks = valueRange > 0 ? [maxV, (minV + maxV) / 2, minV] : [minV];

  const active = activeIndex !== null ? coords[activeIndex] : null;
  const tooltipLeftPct = active ? (active.x / width) * 100 : 0;
  const tooltipTopPct = active ? (active.y / height) * 100 : 0;
  // Flip the tooltip below the point once it's too close to the top edge so
  // it never gets clipped by the chart's own bounding box.
  const tooltipAbove = active ? active.y > height * 0.25 : true;

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <div className="flex gap-1">
        {/* Y axis tick labels, vertically aligned to their gridline via the
            same toY() mapping used inside the SVG. */}
        <div className="relative shrink-0 text-right text-[8px] text-muted-foreground" style={{ width: '1.6rem', height: '4rem' }}>
          {yTicks.map((t, idx) => (
            <span
              key={idx}
              className="absolute right-0 -translate-y-1/2 whitespace-nowrap"
              style={{ top: `${(toY(t) / height) * 100}%` }}
            >
              {round(t)}
            </span>
          ))}
        </div>
        <div className="relative flex-1 min-w-0">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-16"
            preserveAspectRatio="none"
            onMouseLeave={() => setHoverIndex(null)}
            onClick={() => setPinnedIndex(null)}
          >
            {yTicks.map((t, idx) => (
              <line
                key={`grid-${idx}`}
                x1={marginX} x2={width - marginX} y1={toY(t)} y2={toY(t)}
                stroke="currentColor"
                strokeOpacity={0.12}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {segmentList.map((segment, segIdx) => (
              <polyline
                key={segIdx}
                points={segment.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {breaks.map((b, idx) => {
              // Boundary sits between the last point of the outgoing segment and
              // the first point of the incoming one.
              const x = (coords[b.atIndex - 1].x + coords[b.atIndex].x) / 2;
              return (
                <line
                  key={`break-${idx}`}
                  x1={x} x2={x} y1={marginY * 0.25} y2={height - marginY * 0.25}
                  stroke="currentColor"
                  strokeOpacity={0.4}
                  strokeWidth={1}
                  strokeDasharray="2,2"
                  vectorEffect="non-scaling-stroke"
                >
                  <title>Device/generator changed here — readings before and after are from different batteries.</title>
                </line>
              );
            })}
            {activeIndex !== null && (
              <line
                x1={coords[activeIndex].x} x2={coords[activeIndex].x}
                y1={marginY * 0.25} y2={height - marginY * 0.25}
                stroke="currentColor"
                strokeOpacity={0.35}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {coords.map((c, idx) => (
              <circle
                key={idx}
                cx={c.x} cy={c.y}
                r={idx === activeIndex ? 3.5 : 2.2}
                fill="currentColor"
              />
            ))}
            {/* Invisible larger hit targets — the visible markers (r=2.2) are
                too small to reliably hover/tap on their own. */}
            {coords.map((c, idx) => (
              <circle
                key={`hit-${idx}`}
                cx={c.x} cy={c.y}
                r={7}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoverIndex(idx)}
                onClick={(e) => {
                  e.stopPropagation();
                  setPinnedIndex(prev => (prev === idx ? null : idx));
                }}
              >
                <title>{`${formatDate(c.point.date)}: ${c.point.value}${unit ? ` ${unit}` : ''}`}</title>
              </circle>
            ))}
          </svg>
          {active && (
            <div
              className="pointer-events-none absolute z-10 whitespace-nowrap rounded border border-border bg-popover px-1.5 py-0.5 text-[9px] text-popover-foreground shadow-sm"
              style={{
                left: `${tooltipLeftPct}%`,
                top: tooltipAbove ? `${tooltipTopPct}%` : `${tooltipTopPct}%`,
                transform: `translate(-50%, ${tooltipAbove ? '-120%' : '20%'})`,
              }}
            >
              <div className="font-medium">{formatDate(active.point.date)}</div>
              <div>
                {active.point.value}{unit ? ` ${unit}` : ''}
                {active.point.deviceSerial ? ` · ${active.point.deviceSerial}` : ''}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground">
        <span>{formatDate(points[0].date)}</span>
        <span className="font-medium text-foreground">
          {values[values.length - 1]}{unit ? ` ${unit}` : ''}
        </span>
        <span>{formatDate(points[points.length - 1].date)}</span>
      </div>
      {/* Legend: the diagram states its own dimensions and value range rather
          than relying on surrounding page context (#154). */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[9px] text-muted-foreground border-t border-border/60 pt-0.5">
        <span>
          Y: {label || 'Value'}{unit ? ` (${unit})` : ''} · X: Visit date
        </span>
        <span>
          Range: {round(minV)}{unit ? ` ${unit}` : ''} – {round(maxV)}{unit ? ` ${unit}` : ''}
        </span>
        {breaks.length > 0 && (
          <span className="flex items-center gap-1 basis-full">
            <svg width="10" height="8" className="shrink-0" aria-hidden="true">
              <line x1="5" y1="0" x2="5" y2="8" stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} strokeDasharray="2,2" />
            </svg>
            Dashed line = device/generator changed
          </span>
        )}
      </div>
    </div>
  );
};

export default TrendChart;
