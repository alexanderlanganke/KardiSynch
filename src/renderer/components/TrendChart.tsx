import React from 'react';
import { cn, formatDate } from '@/lib/utils';

export interface TrendPoint {
  date: string;
  value: number;
}

interface TrendChartProps {
  points: TrendPoint[];
  unit?: string;
  // Tailwind text-color class applied to the wrapping element; the SVG
  // strokes/fills with currentColor so it follows that class and the
  // light/dark theme automatically.
  className?: string;
}

// Minimal, dependency-free SVG line chart. Renders a value-over-time trend for
// a single numeric field (e.g. battery voltage, lead impedance) across visits.
// X position is proportional to actual elapsed time between visits (not just
// point index), so an uneven follow-up schedule reads correctly.
const TrendChart: React.FC<TrendChartProps> = ({ points, unit, className = 'text-primary' }) => {
  if (points.length < 2) return null;

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
  const polylinePoints = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-16" preserveAspectRatio="none">
        <polyline
          points={polylinePoints}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        {coords.map((c, idx) => (
          <circle key={idx} cx={c.x} cy={c.y} r={2.2} fill="currentColor">
            <title>{`${formatDate(c.point.date)}: ${c.point.value}${unit ? ` ${unit}` : ''}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-[9px] text-muted-foreground">
        <span>{formatDate(points[0].date)}</span>
        <span className="font-medium text-foreground">
          {values[values.length - 1]}{unit ? ` ${unit}` : ''}
        </span>
        <span>{formatDate(points[points.length - 1].date)}</span>
      </div>
    </div>
  );
};

export default TrendChart;
