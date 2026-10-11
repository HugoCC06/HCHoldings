// Valuation maths for the acquisition pipeline. Every input is an explicit, editable assumption.
import type { Assumptions } from './schemas';

export type ScenarioKey = 'pessimistic' | 'base' | 'optimistic';
export const SCENARIOS: { key: ScenarioKey; label: string }[] = [
  { key: 'pessimistic', label: 'Pessimistic' },
  { key: 'base', label: 'Base' },
  { key: 'optimistic', label: 'Optimistic' },
];

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  annualProfitOverride: null,
  pessimistic: { multiple: 2, growthPct: -10, discountPct: 20, years: 5, exitMultiple: 2 },
  base: { multiple: 3, growthPct: 5, discountPct: 15, years: 5, exitMultiple: 3 },
  optimistic: { multiple: 4, growthPct: 20, discountPct: 12, years: 5, exitMultiple: 4 },
  notes: '',
};

export interface DcfResult {
  flows: { year: number; profit: number; discounted: number }[];
  pvFlows: number;
  exitValue: number;
  pvExit: number;
  total: number;
}

/** Simple multiple-of-annual-profit valuation. */
export function multipleValuation(annualProfit: number, multiple: number): number {
  return Math.round(annualProfit * multiple);
}

/**
 * Discounted cash flow: profit grows at growthPct per year for `years`, each year is discounted
 * at discountPct, and the business is assumed sold at the end for exitMultiple × final-year profit.
 */
export function dcf(annualProfit: number, s: { growthPct: number; discountPct: number; years: number; exitMultiple: number }): DcfResult {
  const g = s.growthPct / 100;
  const r = s.discountPct / 100;
  const flows: DcfResult['flows'] = [];
  let profit = annualProfit;
  let pvFlows = 0;
  for (let y = 1; y <= s.years; y++) {
    profit = profit * (1 + g);
    const discounted = profit / Math.pow(1 + r, y);
    pvFlows += discounted;
    flows.push({ year: y, profit: Math.round(profit), discounted: Math.round(discounted) });
  }
  const exitValue = profit * s.exitMultiple;
  const pvExit = exitValue / Math.pow(1 + r, s.years);
  return {
    flows,
    pvFlows: Math.round(pvFlows),
    exitValue: Math.round(exitValue),
    pvExit: Math.round(pvExit),
    total: Math.round(pvFlows + pvExit),
  };
}

/** Annual cash yield and simple payback period at a given purchase price. */
export function returnAtPrice(price: number, annualProfit: number): { yield: number | null; paybackYears: number | null } {
  if (price <= 0) return { yield: null, paybackYears: null };
  return { yield: annualProfit / price, paybackYears: annualProfit > 0 ? price / annualProfit : null };
}

/** Internal rate of return for paying `price` today and receiving the DCF profit stream plus exit value. */
export function irr(price: number, annualProfit: number, s: { growthPct: number; years: number; exitMultiple: number }): number | null {
  if (price <= 0) return null;
  const g = s.growthPct / 100;
  const cash: number[] = [];
  let p = annualProfit;
  for (let y = 1; y <= s.years; y++) {
    p *= 1 + g;
    cash.push(y === s.years ? p + p * s.exitMultiple : p);
  }
  const npv = (rate: number) => cash.reduce((sum, c, i) => sum + c / Math.pow(1 + rate, i + 1), -price);
  let lo = -0.99;
  let hi = 10;
  if (npv(lo) < 0 || npv(hi) > 0) return null; // no root in a sensible range
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Highest price that still delivers `targetYieldPct` annual cash yield. */
export function maxPriceForYield(annualProfit: number, targetYieldPct: number): number | null {
  if (targetYieldPct <= 0 || annualProfit <= 0) return null;
  return Math.round(annualProfit / (targetYieldPct / 100));
}

export interface PeriodFigures { period: string; revenue: number; profit: number; verified: boolean }

/** Trailing twelve months of reported figures (latest 12 periods), with how many are verified. */
export function ttmFromHistory(rows: PeriodFigures[]): { revenue: number; profit: number; months: number; verifiedMonths: number; annualisedProfit: number } | null {
  if (!rows.length) return null;
  const last = [...rows].sort((a, b) => b.period.localeCompare(a.period)).slice(0, 12);
  const revenue = last.reduce((s, r) => s + r.revenue, 0);
  const profit = last.reduce((s, r) => s + r.profit, 0);
  return {
    revenue,
    profit,
    months: last.length,
    verifiedMonths: last.filter((r) => r.verified).length,
    annualisedProfit: Math.round((profit * 12) / last.length),
  };
}
