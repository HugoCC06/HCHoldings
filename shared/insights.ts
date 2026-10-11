// Derived signals for the dashboard: warnings, next actions, goal progress and asset comparison.
import { PRIORITY_RANK, type Priority, type TaskStatus } from './domain';
import { addMonths, daysBetween, lastDayOfMonth, monthOf } from './dates';
import {
  capitalInvestedInAsset, cashCoverMonths, concentration, growth, latestValuation, margin, monthlyTotals, roic,
  sumTotals, windowTotals, type AssetLite, type BalanceLite, type Roic, type TxnLite, type ValuationLite,
} from './finance';

export interface Warning { level: 'critical' | 'warning' | 'info'; title: string; detail: string; link?: string }

interface TaskLite { id: number; title: string; status: TaskStatus; priority: Priority; deadline: string | null; asset_id: number | null; project_id?: number | null }
interface MilestoneLite { id: number; title: string; target_date: string | null; completed_at: string | null; asset_id: number | null }
interface NamedAsset extends AssetLite { name: string }

export function isOverdue(t: { status: string; deadline: string | null }, today: string): boolean {
  return t.status !== 'completed' && !!t.deadline && t.deadline < today;
}

/** Open tasks ordered by what most deserves attention: overdue, then priority, then deadline. */
export function rankNextActions<T extends TaskLite>(tasks: T[], today: string, limit = 8): T[] {
  const score = (t: T) => {
    let s = PRIORITY_RANK[t.priority] * 10;
    if (isOverdue(t, today)) s -= 100;
    else if (t.deadline && daysBetween(today, t.deadline) <= 7) s -= 40;
    if (t.status === 'in_progress') s -= 15;
    else if (t.status === 'next') s -= 10;
    else if (t.status === 'waiting') s += 20;
    else if (t.status === 'backlog') s += 30;
    return s;
  };
  return tasks
    .filter((t) => t.status !== 'completed')
    .sort((a, b) => score(a) - score(b) || (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.id - b.id)
    .slice(0, limit);
}

export function buildWarnings(input: {
  today: string;
  assets: NamedAsset[];
  txns: TxnLite[];
  tasks: TaskLite[];
  milestones: MilestoneLite[];
  balances: BalanceLite[];
  accountIds: number[];
}): Warning[] {
  const { today, assets, txns, tasks, milestones, balances, accountIds } = input;
  const out: Warning[] = [];
  const last = addMonths(monthOf(today), -1);
  const prev = addMonths(last, -1);
  const [p, l] = monthlyTotals(txns, [prev, last]);

  const overdue = tasks.filter((t) => isOverdue(t, today));
  if (overdue.length)
    out.push({ level: overdue.length > 3 ? 'critical' : 'warning', title: `${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}`, detail: overdue.slice(0, 3).map((t) => t.title).join(' · '), link: '/work' });

  const lateMilestones = milestones.filter((m) => !m.completed_at && m.target_date && m.target_date < today);
  if (lateMilestones.length)
    out.push({ level: 'warning', title: `${lateMilestones.length} milestone${lateMilestones.length > 1 ? 's' : ''} past target date`, detail: lateMilestones.slice(0, 3).map((m) => m.title).join(' · '), link: '/work?view=milestones' });

  if (l.count && l.profit < 0)
    out.push({ level: 'warning', title: 'Operating loss last month', detail: `Expenses exceeded revenue in ${last}.`, link: '/finance' });

  const opexGrowth = growth(l.opex, p.opex);
  if (opexGrowth !== null && opexGrowth >= 0.25 && l.opex - p.opex > 5000)
    out.push({ level: 'info', title: 'Operating expenses rose sharply', detail: `Up ${(opexGrowth * 100).toFixed(0)}% month on month.`, link: '/finance' });

  for (const a of assets) {
    if (a.archived || a.status !== 'operating') continue;
    const at = txns.filter((t) => t.asset_id === a.id);
    const [ap, al] = monthlyTotals(at, [prev, last]);
    const g = growth(al.revenue, ap.revenue);
    if (g !== null && g <= -0.2 && ap.revenue >= 1000)
      out.push({ level: 'warning', title: `${a.name}: revenue down ${Math.abs(g * 100).toFixed(0)}%`, detail: `Compared with the previous month.`, link: `/assets/${a.id}` });
    if (at.length && al.revenue === 0 && ap.revenue > 0)
      out.push({ level: 'warning', title: `${a.name}: no revenue recorded last month`, detail: 'Check whether income is missing or the asset has stalled.', link: `/assets/${a.id}` });
  }

  const ttmStart = addMonths(last, -11);
  const ttmTxns = txns.filter((t) => monthOf(t.date) >= ttmStart && monthOf(t.date) <= last);
  const conc = concentration(ttmTxns);
  if (conc.shares.length >= 2 && conc.topShare !== null && conc.topShare > 0.6) {
    const top = assets.find((a) => a.id === conc.shares[0].assetId);
    out.push({ level: 'info', title: 'High revenue concentration', detail: `${top?.name ?? 'One source'} produced ${(conc.topShare * 100).toFixed(0)}% of trailing-12-month revenue.`, link: '/performance' });
  }

  if (accountIds.length) {
    const latestByAccount = accountIds.map((id) => balances.filter((b) => b.account_id === id).reduce<string | null>((m, b) => (!m || b.date > m ? b.date : m), null));
    const stale = latestByAccount.filter((d) => !d || daysBetween(d, today) > 45).length;
    if (stale) out.push({ level: 'info', title: 'Cash balances need updating', detail: `${stale} account${stale > 1 ? 's have' : ' has'} no balance recorded in the last 45 days.`, link: '/finance?tab=cash' });
    const cash = balances.length ? latestCash(balances, accountIds) : null;
    const avgOpex = sumTotals(txns.filter((t) => monthOf(t.date) >= addMonths(last, -2) && monthOf(t.date) <= last)).opex / 3;
    const cover = cash !== null ? cashCoverMonths(cash, avgOpex) : null;
    if (cover !== null && cover < 3)
      out.push({ level: cover < 1 ? 'critical' : 'warning', title: 'Low cash cover', detail: `Cash covers ${cover.toFixed(1)} months of average operating expenses.`, link: '/finance?tab=cash' });
  }
  const rank = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

function latestCash(balances: BalanceLite[], accountIds: number[]): number {
  let total = 0;
  for (const id of accountIds) {
    const latest = balances.filter((b) => b.account_id === id).sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0))[0];
    if (latest) total += latest.balance;
  }
  return total;
}

export interface AssetPerformance {
  assetId: number;
  lastMonth: { revenue: number; opex: number; profit: number };
  prevMonth: { revenue: number; profit: number };
  ttm: { revenue: number; opex: number; profit: number; monthsCovered: number };
  margin: number | null;
  revenueGrowth: number | null;
  invested: number;
  value: number | null;
  valueDate: string | null;
  roic: Roic | null;
  /** Value + cumulative profit − capital invested */
  totalGain: number | null;
  cumulativeProfit: number;
}

/**
 * Performance of one asset for `endMonth`. With `current` set, invested capital and value are the
 * latest recorded (used for live views); otherwise they are as of the end of `endMonth` (reports).
 */
export function assetPerformance(asset: AssetLite, txns: TxnLite[], valuations: ValuationLite[], endMonth: string, current = false): AssetPerformance {
  const at = txns.filter((t) => t.asset_id === asset.id);
  const [p, l] = monthlyTotals(at, [addMonths(endMonth, -1), endMonth]);
  const w = windowTotals(at, endMonth, 12);
  const end = lastDayOfMonth(endMonth);
  const asOf = current ? undefined : end;
  const invested = capitalInvestedInAsset(asset, at, asOf);
  const v = latestValuation(valuations, asset.id, asOf);
  const cumulativeProfit = sumTotals(at.filter((t) => !asOf || t.date <= asOf)).profit;
  return {
    assetId: asset.id,
    lastMonth: { revenue: l.revenue, opex: l.opex, profit: l.profit },
    prevMonth: { revenue: p.revenue, profit: p.profit },
    ttm: { revenue: w.revenue, opex: w.opex, profit: w.profit, monthsCovered: w.monthsCovered },
    margin: margin(w.revenue, w.profit),
    revenueGrowth: growth(l.revenue, p.revenue),
    invested,
    value: v?.value ?? null,
    valueDate: v?.date ?? null,
    roic: roic(w, invested),
    totalGain: v ? v.value + cumulativeProfit - invested : null,
    cumulativeProfit,
  };
}

export interface GoalLite { metric: string; metric_name: string | null; target_value: number; manual_actual: number | null; asset_id: number }
export interface MetricLite { asset_id: number; name: string; date: string; value: number; id?: number }

/**
 * Actual value for a goal. Revenue/profit goals are in minor units and use the last complete month.
 * Returns null when there is no data to compare against.
 */
export function goalActual(goal: GoalLite, txns: TxnLite[], metrics: MetricLite[], endMonth: string): number | null {
  if (goal.metric === 'monthly_revenue' || goal.metric === 'monthly_profit') {
    const at = txns.filter((t) => t.asset_id === goal.asset_id);
    if (!at.length) return null;
    const [m] = monthlyTotals(at, [endMonth]);
    return goal.metric === 'monthly_revenue' ? m.revenue : m.profit;
  }
  if (goal.metric === 'metric') {
    const latest = latestMetric(metrics, goal.asset_id, goal.metric_name ?? '');
    return latest?.value ?? null;
  }
  return goal.manual_actual;
}

export function goalProgress(actual: number | null, target: number): number | null {
  if (actual === null || target === 0) return null;
  return actual / target;
}

export function latestMetric(metrics: MetricLite[], assetId: number, name: string): MetricLite | null {
  const key = name.trim().toLowerCase();
  const list = metrics
    .filter((m) => m.asset_id === assetId && m.name.trim().toLowerCase() === key)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0));
  return list[0] ?? null;
}

/** Growth between the latest two snapshots of each metric for an asset. */
export function metricTrends(metrics: MetricLite[], assetId: number): { name: string; latest: number; date: string; previous: number | null; change: number | null }[] {
  const byName = new Map<string, MetricLite[]>();
  for (const m of metrics) {
    if (m.asset_id !== assetId) continue;
    const k = m.name.trim().toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), m]);
  }
  return [...byName.values()].map((list) => {
    const sorted = list.sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0));
    const latest = sorted[0];
    const previous = sorted[1]?.value ?? null;
    return { name: latest.name.trim(), latest: latest.value, date: latest.date, previous, change: previous === null ? null : growth(latest.value, previous) };
  });
}
