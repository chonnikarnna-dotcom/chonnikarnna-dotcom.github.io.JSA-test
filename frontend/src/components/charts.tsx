/** Chart primitives (recharts) following the data-viz method: one axis, thin marks, recessive grid, tooltips, legends for ≥2 series. */
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Reference categorical palette — fixed order, never cycled.
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const AXIS = { fontSize: 11, fill: '#52514e' };
const GRID = '#e7e5e4';

export type Datum = Record<string, string | number | null>;

/** Single-series horizontal bars — for category comparison with long (Thai/English) labels. */
export function HBar({ data, labelKey, valueKey, colorKey, height, valueLabel }: { data: Datum[]; labelKey: string; valueKey: string; colorKey?: string; height?: number; valueLabel: string }) {
  if (!data.length) return null;
  const h = height ?? Math.max(120, data.length * 34 + 30);
  return (
    <div style={{ height: h }} role="img" aria-label={`${valueLabel}: ${data.map((d) => `${d[labelKey]} ${d[valueKey]}`).join(', ')}`}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey={labelKey} width={150} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => [v as number, valueLabel]} />
          <Bar dataKey={valueKey} name={valueLabel} radius={[0, 4, 4, 0]} maxBarSize={22} label={{ position: 'right', fontSize: 11, fill: '#0b0b0b' }}>
            {data.map((d, i) => <Cell key={i} fill={colorKey && d[colorKey] ? String(d[colorKey]) : SERIES[0]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Vertical bars over time; one or more series (legend shown for ≥2). */
export function VBar({ data, xKey, series, height = 220 }: { data: Datum[]; xKey: string; series: { key: string; label: string }[]; height?: number }) {
  if (!data.length) return null;
  return (
    <div style={{ height }} role="img" aria-label={series.map((s) => `${s.label}: ${data.map((d) => `${d[xKey]} ${d[s.key]}`).join(', ')}`).join('; ')}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: -16, right: 8, top: 8, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey={xKey} tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} />
          <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: '#f1f5f9' }} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />}
          {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={28} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
