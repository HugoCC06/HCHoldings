import { useMemo } from 'react';
import { addMonths, monthOf, monthRange, todayISO } from '../../shared/dates';
import {
  cashPosition, concentration, growth, lastCompleteMonth, margin, monthlyTotals, portfolioSeries, portfolioValue, roic,
  sumTotals, totalCapitalInvested, windowTotals, firstTxnMonth,
} from '../../shared/finance';
import { assetPerformance, buildWarnings } from '../../shared/insights';
import type { Snapshot } from './api';
import { assetColorMap } from '../components/charts';

/** Everything the dashboard/report/performance pages need, derived once from the recorded data. */
export function derivePortfolio(s: Snapshot, endMonth: string, today = todayISO()) {
  const txns = s.transactions;
  const assets = s.assets;
  const first = firstTxnMonth(txns);
  const startDefault = addMonths(endMonth, -11);
  const chartStart = first && first > startDefault ? first : startDefault;
  const months = monthRange(chartStart, endMonth);
  const monthly = monthlyTotals(txns, months);
  const [prev, last] = monthlyTotals(txns, [addMonths(endMonth, -1), endMonth]);
  const ttm = windowTotals(txns, endMonth, 12);
  const prevTtm = windowTotals(txns, addMonths(endMonth, -12), 12);
  const ytdMonths = monthRange(`${endMonth.slice(0, 4)}-01`, endMonth);
  const ytd = sumTotals(txns.filter((t) => ytdMonths.includes(monthOf(t.date))));
  const invested = totalCapitalInvested(assets, txns);
  const value = portfolioValue(s.valuations);
  const accountIds = s.cashAccounts.filter((a) => !a.archived).map((a) => a.id);
  const cash = cashPosition(s.cashBalances, accountIds);
  const series = portfolioSeries(assets, txns, s.valuations, months);
  const colorOf = assetColorMap(assets);
  const ttmTxns = txns.filter((t) => monthOf(t.date) >= addMonths(endMonth, -11) && monthOf(t.date) <= endMonth);
  const conc = concentration(ttmTxns);
  const perf = assets.map((a) => ({ asset: a, ...assetPerformance(a, txns, s.valuations, endMonth) }));
  const allTime = sumTotals(txns);

  // revenue by asset per month (stacked)
  const revenueAssets = [...new Set(txns.filter((t) => t.category === 'revenue').map((t) => t.asset_id))];
  const revenueSeries = revenueAssets
    .map((id) => {
      const a = assets.find((x) => x.id === id);
      return { key: `a${id ?? 'h'}`, id, label: a?.name ?? 'Holding company', color: colorOf(id) };
    })
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  const revenueByMonth = months.map((m) => {
    const row: Record<string, number | string> = { month: m };
    for (const sr of revenueSeries) row[sr.key] = 0;
    for (const t of txns) if (t.category === 'revenue' && monthOf(t.date) === m) row[`a${t.asset_id ?? 'h'}`] = (row[`a${t.asset_id ?? 'h'}`] as number) + t.amount;
    return row;
  });

  return {
    endMonth, months, monthly, last, prev, ttm, prevTtm, ytd, invested, value, cash, series, colorOf, conc, perf, allTime,
    revenueSeries, revenueByMonth,
    margin: margin(last.revenue, last.profit),
    ttmMargin: margin(ttm.revenue, ttm.profit),
    revenueGrowth: growth(last.revenue, prev.revenue),
    profitGrowth: growth(last.profit, prev.profit),
    ttmRevenueGrowth: prevTtm.monthsCovered >= 12 ? growth(ttm.revenue, prevTtm.revenue) : null,
    roic: roic(ttm, invested),
    warnings: buildWarnings({ today, assets, txns, tasks: s.tasks, milestones: s.milestones, balances: s.cashBalances, accountIds }),
    hasData: txns.length > 0,
  };
}

export function usePortfolio(s: Snapshot | undefined, endMonth?: string) {
  return useMemo(() => (s ? derivePortfolio(s, endMonth ?? lastCompleteMonth(todayISO())) : null), [s, endMonth]);
}
