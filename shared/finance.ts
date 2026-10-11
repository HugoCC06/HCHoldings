// Pure financial calculations. Everything shown on screen is derived here from recorded data,
// so these functions are the single source of truth and are covered by tests.
import { TXN_CATEGORIES, type TxnCategory, type TxnClass } from './domain';
import { addMonths, daysBetween, lastDayOfMonth, monthOf, monthRange } from './dates';

export interface TxnLite { date: string; asset_id: number | null; category: TxnCategory; amount: number }
export interface ValuationLite { asset_id: number; date: string; value: number; id?: number }
export interface AssetLite {
  id: number; status: string; origin: string; start_date: string | null; acquisition_price: number | null; archived?: boolean;
}

export interface Totals {
  revenue: number;
  opex: number;
  /** revenue − opex */
  profit: number;
  /** capital deployed into assets (one-off investments, acquisition costs) */
  capital: number;
  ownerIn: number;
  ownerOut: number;
  /** revenue − opex − capital + ownerIn − ownerOut (excludes asset purchase prices, see cashFlow helpers) */
  netCashFlow: number;
  opexByCategory: Partial<Record<TxnCategory, number>>;
  count: number;
}
export interface MonthTotals extends Totals { month: string }

export function classOf(category: TxnCategory): TxnClass {
  return TXN_CATEGORIES[category].class;
}

export function emptyTotals(): Totals {
  return { revenue: 0, opex: 0, profit: 0, capital: 0, ownerIn: 0, ownerOut: 0, netCashFlow: 0, opexByCategory: {}, count: 0 };
}

function add(t: Totals, x: TxnLite) {
  t.count++;
  switch (classOf(x.category)) {
    case 'revenue':
      t.revenue += x.amount;
      break;
    case 'opex':
      t.opex += x.amount;
      t.opexByCategory[x.category] = (t.opexByCategory[x.category] ?? 0) + x.amount;
      break;
    case 'capital':
      t.capital += x.amount;
      break;
    case 'owner':
      if (x.category === 'owner_contribution') t.ownerIn += x.amount;
      else t.ownerOut += x.amount;
      break;
  }
}
function finish<T extends Totals>(t: T): T {
  t.profit = t.revenue - t.opex;
  t.netCashFlow = t.revenue - t.opex - t.capital + t.ownerIn - t.ownerOut;
  return t;
}

export function sumTotals(txns: TxnLite[]): Totals {
  const t = emptyTotals();
  for (const x of txns) add(t, x);
  return finish(t);
}

/** Totals for each month in `months` (inclusive list). Transactions outside the list are ignored. */
export function monthlyTotals(txns: TxnLite[], months: string[]): MonthTotals[] {
  const map = new Map<string, MonthTotals>();
  for (const m of months) map.set(m, { month: m, ...emptyTotals() });
  for (const x of txns) {
    const row = map.get(monthOf(x.date));
    if (row) add(row, x);
  }
  return months.map((m) => finish(map.get(m)!));
}

export function margin(revenue: number, profit: number): number | null {
  return revenue > 0 ? profit / revenue : null;
}

/** Period-over-period change. Null when there is no meaningful base (previous is zero). */
export function growth(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / Math.abs(previous);
}

/** The latest fully completed calendar month relative to `today`. */
export function lastCompleteMonth(today: string): string {
  return addMonths(monthOf(today), -1);
}

export function firstTxnMonth(txns: TxnLite[]): string | null {
  let min: string | null = null;
  for (const t of txns) if (min === null || t.date < min) min = t.date;
  return min ? monthOf(min) : null;
}

export interface WindowTotals extends Totals {
  /** Number of months in the window that fall on/after the first recorded transaction. */
  monthsCovered: number;
}

/** Trailing window of `length` months ending at `endMonth` (inclusive). */
export function windowTotals(txns: TxnLite[], endMonth: string, length = 12): WindowTotals {
  const start = addMonths(endMonth, -(length - 1));
  const inWindow = txns.filter((t) => {
    const m = monthOf(t.date);
    return m >= start && m <= endMonth;
  });
  const first = firstTxnMonth(txns);
  const coveredFrom = first && first > start ? first : start;
  const monthsCovered = first && first <= endMonth ? monthRange(coveredFrom, endMonth).length : 0;
  return { ...sumTotals(inWindow), monthsCovered };
}

/** Purchase price (if acquired on or before `asOf`) plus capital transactions recorded against the asset. */
export function capitalInvestedInAsset(asset: AssetLite, txns: TxnLite[], asOf?: string): number {
  let total = 0;
  if (asset.acquisition_price && (!asOf || !asset.start_date || asset.start_date <= asOf)) total += asset.acquisition_price;
  for (const t of txns) {
    if (t.asset_id === asset.id && classOf(t.category) === 'capital' && (!asOf || t.date <= asOf)) total += t.amount;
  }
  return total;
}

/** Capital invested across the portfolio: all purchase prices + every capital transaction (including holding-level ones). */
export function totalCapitalInvested(assets: AssetLite[], txns: TxnLite[], asOf?: string): number {
  let total = 0;
  for (const a of assets) {
    if (a.acquisition_price && (!asOf || !a.start_date || a.start_date <= asOf)) total += a.acquisition_price;
  }
  for (const t of txns) if (classOf(t.category) === 'capital' && (!asOf || t.date <= asOf)) total += t.amount;
  return total;
}

/** Most recent valuation on or before `asOf` (ties broken by highest id = latest entered). */
export function latestValuation<V extends ValuationLite>(valuations: V[], assetId: number, asOf?: string): V | null {
  let best: V | null = null;
  for (const v of valuations) {
    if (v.asset_id !== assetId || (asOf && v.date > asOf)) continue;
    if (!best || v.date > best.date || (v.date === best.date && (v.id ?? 0) > (best.id ?? 0))) best = v;
  }
  return best;
}

/** Sum of each asset's latest estimated value as of `asOf`. Null when nothing has been valued yet. */
export function portfolioValue(valuations: ValuationLite[], asOf?: string): { value: number; assetsValued: number } | null {
  const ids = new Set(valuations.map((v) => v.asset_id));
  let value = 0;
  let n = 0;
  for (const id of ids) {
    const v = latestValuation(valuations, id, asOf);
    if (v) {
      value += v.value;
      n++;
    }
  }
  return n ? { value, assetsValued: n } : null;
}

export interface PortfolioPoint { month: string; value: number | null; invested: number; cumulativeProfit: number }

/** Month-end portfolio value, cumulative capital invested and cumulative operating profit. */
export function portfolioSeries(assets: AssetLite[], txns: TxnLite[], valuations: ValuationLite[], months: string[]): PortfolioPoint[] {
  const monthly = monthlyTotals(txns, months);
  const first = months[0];
  const before = first ? sumTotals(txns.filter((t) => monthOf(t.date) < first)) : emptyTotals();
  let cum = before.profit;
  return months.map((m, i) => {
    cum += monthly[i].profit;
    const end = lastDayOfMonth(m);
    return {
      month: m,
      value: portfolioValue(valuations, end)?.value ?? null,
      invested: totalCapitalInvested(assets, txns, end),
      cumulativeProfit: cum,
    };
  });
}

export interface Roic { value: number; annualised: boolean; profit: number; invested: number }

/**
 * Return on invested capital = trailing-12-month operating profit / capital invested.
 * With less than 12 months of history the profit is annualised and flagged. Null when not computable.
 */
export function roic(window: WindowTotals, invested: number): Roic | null {
  if (invested <= 0 || window.monthsCovered <= 0 || window.count === 0) return null;
  const annualised = window.monthsCovered < 12;
  const profit = annualised ? Math.round((window.profit * 12) / window.monthsCovered) : window.profit;
  return { value: profit / invested, annualised, profit, invested };
}

export interface ConcentrationShare { assetId: number | null; revenue: number; share: number }
export interface Concentration { shares: ConcentrationShare[]; topShare: number | null; hhi: number | null }

/** Revenue concentration by asset. HHI is 0–1 (1 = everything from one asset). */
export function concentration(txns: TxnLite[]): Concentration {
  const by = new Map<number | null, number>();
  let total = 0;
  for (const t of txns) {
    if (classOf(t.category) !== 'revenue') continue;
    by.set(t.asset_id, (by.get(t.asset_id) ?? 0) + t.amount);
    total += t.amount;
  }
  if (total <= 0) return { shares: [], topShare: null, hhi: null };
  const shares = [...by.entries()]
    .map(([assetId, revenue]) => ({ assetId, revenue, share: revenue / total }))
    .sort((a, b) => b.revenue - a.revenue);
  return { shares, topShare: shares[0].share, hhi: shares.reduce((s, x) => s + x.share * x.share, 0) };
}

export interface BalanceLite { account_id: number; date: string; balance: number; id?: number }
export interface CashPosition {
  total: number;
  accounts: { accountId: number; balance: number; date: string }[];
  oldestDate: string | null;
}

/** Latest recorded balance per account on or before `asOf`. Null when no balances are recorded. */
export function cashPosition(balances: BalanceLite[], accountIds: number[], asOf?: string): CashPosition | null {
  const accounts: CashPosition['accounts'] = [];
  for (const id of accountIds) {
    let best: BalanceLite | null = null;
    for (const b of balances) {
      if (b.account_id !== id || (asOf && b.date > asOf)) continue;
      if (!best || b.date > best.date || (b.date === best.date && (b.id ?? 0) > (best.id ?? 0))) best = b;
    }
    if (best) accounts.push({ accountId: id, balance: best.balance, date: best.date });
  }
  if (!accounts.length) return null;
  return {
    total: accounts.reduce((s, a) => s + a.balance, 0),
    accounts,
    oldestDate: accounts.reduce((m, a) => (a.date < m ? a.date : m), accounts[0].date),
  };
}

/** Months of operating expenses covered by cash (runway), based on an average monthly opex. */
export function cashCoverMonths(cash: number, avgMonthlyOpex: number): number | null {
  if (avgMonthlyOpex <= 0) return null;
  return cash / avgMonthlyOpex;
}

export function staleness(date: string, today: string): number {
  return daysBetween(date, today);
}

/** Months between first activity and `endMonth`, used for display ranges. Defaults to 12 months. */
export function chartMonths(txns: TxnLite[], endMonth: string, max = 24, min = 12): string[] {
  const first = firstTxnMonth(txns);
  let start = addMonths(endMonth, -(min - 1));
  if (first && first < start) start = first > addMonths(endMonth, -(max - 1)) ? first : addMonths(endMonth, -(max - 1));
  return monthRange(start, endMonth);
}
