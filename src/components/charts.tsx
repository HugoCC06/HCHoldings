import type { ReactNode } from 'react';
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine, AreaChart,
  type TooltipProps,
} from 'recharts';
import { formatMonth } from '../../shared/dates';
import { formatMoney } from '../../shared/money';
import { Empty } from './ui';

/** Categorical palette (validated for CVD separation on the dark surface). Assigned in fixed order. */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const OTHER = '#56627a';

/** Stable colour for an asset: based on creation order, so a filter never repaints survivors. */
export function assetColorMap(assets: { id: number }[]): (id: number | null) => string {
  const order = [...assets].sort((a, b) => a.id - b.id).map((a) => a.id);
  return (id) => {
    if (id === null) return OTHER;
    const i = order.indexOf(id);
    return i >= 0 && i < SERIES.length ? SERIES[i] : OTHER;
  };
}

const axisProps = { stroke: 'transparent', tickLine: false, axisLine: { stroke: '#283a5c' } } as const;

function MoneyTooltip({ active, payload, label, currency, labelFmt }: TooltipProps<number, string> & { currency: string; labelFmt?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="tt-title">{labelFmt ? labelFmt(String(label)) : String(label)}</div>
      {payload.map((p) => (
        <div className="tt-row" key={String(p.dataKey)}>
          <span>
            <i className="dot" style={{ background: (p.color ?? p.stroke) as string }} />
            {p.name}
          </span>
          <b>{p.value === null || p.value === undefined ? '—' : formatMoney(Number(p.value), currency)}</b>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; line?: boolean; dashed?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i className={i.line ? 'line' : undefined} style={{ background: i.dashed ? `repeating-linear-gradient(90deg, ${i.color} 0 4px, transparent 4px 7px)` : i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function ChartFrame({ height = 260, children, legend }: { height?: number; children: ReactNode; legend?: ReactNode }) {
  return (
    <div className="chart-box">
      {legend && <div style={{ marginBottom: 10 }}>{legend}</div>}
      <div style={{ height }}>{children}</div>
    </div>
  );
}

const compact = (currency: string) => (v: number) => formatMoney(v, currency, { compact: true });

export interface CashflowPoint { month: string; revenue: number; opex: number; profit: number }

/** Monthly revenue and expenses as bars with operating profit as a line. Single money axis. */
export function CashflowChart({ data, currency, height = 280 }: { data: CashflowPoint[]; currency: string; height?: number }) {
  if (!data.some((d) => d.revenue || d.opex)) return <Empty compact title="No revenue or expenses recorded yet">Add transactions in Finance to see monthly performance.</Empty>;
  const rows = data.map((d) => ({ ...d, expenses: d.opex }));
  return (
    <ChartFrame
      height={height}
      legend={<Legend items={[{ label: 'Revenue', color: SERIES[0] }, { label: 'Operating expenses', color: SERIES[1] }, { label: 'Operating profit', color: SERIES[2], line: true }]} />}
    >
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 6, right: 6, left: 6, bottom: 0 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="month" tickFormatter={(m) => formatMonth(m)} {...axisProps} minTickGap={12} />
          <YAxis tickFormatter={compact(currency)} {...axisProps} axisLine={false} width={64} />
          <ReferenceLine y={0} stroke="#33476d" />
          <Tooltip content={<MoneyTooltip currency={currency} labelFmt={(m) => formatMonth(m, true)} />} cursor={{ fill: 'rgba(110,168,240,0.06)' }} />
          <Bar dataKey="revenue" name="Revenue" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="expenses" name="Operating expenses" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Line dataKey="profit" name="Operating profit" stroke={SERIES[2]} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: SERIES[2] }} activeDot={{ r: 5, stroke: '#0f1729', strokeWidth: 2 }} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Revenue by asset per month, stacked. Assets beyond the palette fold into "Other". */
export function RevenueByAssetChart({ data, series, currency, height = 280 }: { data: Record<string, number | string>[]; series: { key: string; label: string; color: string }[]; currency: string; height?: number }) {
  if (!series.length) return <Empty compact title="No revenue recorded yet">Record revenue against an asset to see each asset’s contribution.</Empty>;
  return (
    <ChartFrame height={height} legend={<Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 6, right: 6, left: 6, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="month" tickFormatter={(m) => formatMonth(m)} {...axisProps} minTickGap={12} />
          <YAxis tickFormatter={compact(currency)} {...axisProps} axisLine={false} width={64} />
          <Tooltip content={<MoneyTooltip currency={currency} labelFmt={(m) => formatMonth(m, true)} />} cursor={{ fill: 'rgba(110,168,240,0.06)' }} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} stackId="rev" fill={s.color} stroke="#0f1729" strokeWidth={1} maxBarSize={30} radius={i === series.length - 1 ? [4, 4, 0, 0] : undefined} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export interface PortfolioChartPoint { month: string; value: number | null; invested: number; cumulativeProfit: number }

/** Estimated portfolio value vs capital invested (and cumulative operating profit), all in the same currency axis. */
export function PortfolioChart({ data, currency, height = 280 }: { data: PortfolioChartPoint[]; currency: string; height?: number }) {
  const hasValue = data.some((d) => d.value !== null);
  const hasInvested = data.some((d) => d.invested > 0);
  if (!hasValue && !hasInvested) return <Empty compact title="No valuations or invested capital yet">Record asset valuations and capital invested to track portfolio growth.</Empty>;
  return (
    <ChartFrame
      height={height}
      legend={<Legend items={[{ label: 'Estimated value', color: SERIES[0], line: true }, { label: 'Capital invested', color: SERIES[3], line: true, dashed: true }, { label: 'Cumulative operating profit', color: SERIES[2], line: true }]} />}
    >
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
          <defs>
            <linearGradient id="valueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.22} />
              <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="month" tickFormatter={(m) => formatMonth(m)} {...axisProps} minTickGap={12} />
          <YAxis tickFormatter={compact(currency)} {...axisProps} axisLine={false} width={64} />
          <Tooltip content={<MoneyTooltip currency={currency} labelFmt={(m) => formatMonth(m, true)} />} />
          <Area dataKey="value" name="Estimated value" stroke={SERIES[0]} strokeWidth={2} fill="url(#valueFill)" connectNulls type="monotone" dot={false} activeDot={{ r: 4 }} />
          <Line dataKey="invested" name="Capital invested" stroke={SERIES[3]} strokeWidth={2} strokeDasharray="5 4" dot={false} type="stepAfter" />
          <Line dataKey="cumulativeProfit" name="Cumulative operating profit" stroke={SERIES[2]} strokeWidth={2} dot={false} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Simple single-series area, e.g. an asset's value history or a metric. */
export function SimpleArea({ data, dataKey, name, color = SERIES[0], format, height = 200 }: { data: Record<string, unknown>[]; dataKey: string; name: string; color?: string; format: (v: number) => string; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
          <defs>
            <linearGradient id={`fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" {...axisProps} minTickGap={16} />
          <YAxis tickFormatter={format} {...axisProps} axisLine={false} width={64} />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="chart-tooltip">
                  <div className="tt-title">{label}</div>
                  <div className="tt-row">
                    <span>
                      <i className="dot" style={{ background: color }} />
                      {name}
                    </span>
                    <b>{format(Number(payload[0].value))}</b>
                  </div>
                </div>
              ) : null
            }
          />
          <Area dataKey={dataKey} name={name} stroke={color} strokeWidth={2} fill={`url(#fill-${dataKey})`} type="monotone" dot={{ r: 3, fill: color, strokeWidth: 0 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bar list: compact, labelled, readable ranking with values. */
export function BarList({ items, format, empty }: { items: { key: string | number; label: ReactNode; value: number; color?: string; sub?: ReactNode }[]; format: (v: number) => string; empty?: ReactNode }) {
  const max = Math.max(0, ...items.map((i) => Math.abs(i.value)));
  if (!items.length) return <>{empty ?? <Empty compact title="Nothing to show yet" />}</>;
  return (
    <div className="bar-list">
      {items.map((i) => (
        <div className="bar-list-row" key={i.key}>
          <div className="ellipsis">{i.label}</div>
          <div className="bar-track" title={format(i.value)}>
            <div style={{ width: `${max ? (Math.abs(i.value) / max) * 100 : 0}%`, background: i.value < 0 ? 'var(--bad)' : (i.color ?? SERIES[0]) }} />
          </div>
          <div className="num" style={{ minWidth: 86 }}>
            {format(i.value)}
            {i.sub && <div className="cell-sub">{i.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
