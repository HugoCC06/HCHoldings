import { useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { downloadText, useList, useSnapshot } from '../lib/api';
import { derivePortfolio } from '../lib/portfolio';
import { cx, formatNumber, useMoney } from '../lib/format';
import { OPEN_STAGES, OPPORTUNITY_STAGES, TXN_CATEGORIES, OPEX_CATEGORIES, GOAL_METRICS } from '../../shared/domain';
import { addMonths, formatDate, formatMonth, lastDayOfMonth, monthOf, todayISO } from '../../shared/dates';
import { lastCompleteMonth, monthlyTotals, totalCapitalInvested, portfolioValue, cashPosition, margin } from '../../shared/finance';
import { goalActual, goalProgress, rankNextActions } from '../../shared/insights';
import { formatPct, minorToInput } from '../../shared/money';
import { toCsv } from '../../shared/csv';
import { CashflowChart } from '../components/charts';
import { Button, Delta, ErrorBox, Loading, PageHeader, Select } from '../components/ui';

export function ReportsPage() {
  const { data: s, isLoading, error } = useSnapshot();
  const money = useMoney();
  const defaultMonth = lastCompleteMonth(todayISO());
  const [month, setMonth] = useState(defaultMonth);
  const { data: reviews = [] } = useList('reviews', { asset_id: null });
  const p = useMemo(() => (s ? derivePortfolio(s, month) : null), [s, month]);
  if (isLoading) return <Loading />;
  if (error || !s || !p) return <ErrorBox error={error} />;

  const end = lastDayOfMonth(month);
  const start = `${month}-01`;
  const review = reviews.find((r) => r.month === month);
  const invested = totalCapitalInvested(s.assets, s.transactions, end);
  const value = portfolioValue(s.valuations, end);
  const cash = cashPosition(s.cashBalances, s.cashAccounts.filter((a) => !a.archived).map((a) => a.id), end);
  const capitalThisMonth = p.last.capital;
  const assetName = (id: number | null) => (id ? s.assets.find((a) => a.id === id)?.name : null) ?? 'Holding company';
  const assetRows = p.perf.filter((x) => x.lastMonth.revenue || x.lastMonth.opex || x.invested || x.value !== null).sort((a, b) => b.lastMonth.profit - a.lastMonth.profit);
  const holding = monthlyTotals(s.transactions.filter((t) => t.asset_id === null), [month])[0];
  const completedTasks = s.tasks.filter((t) => t.completed_at && t.completed_at >= start && t.completed_at <= end);
  const achieved = s.milestones.filter((m) => m.completed_at && m.completed_at >= start && m.completed_at <= end);
  const completedProjects = s.projects.filter((pr) => pr.status === 'completed' && pr.updated_at.slice(0, 10) >= start && pr.updated_at.slice(0, 10) <= end);
  const goals = s.goals.filter((g) => g.status === 'active' || (g.target_date && monthOf(g.target_date) === month));
  const next = addMonths(month, 1);
  const nextMilestones = s.milestones.filter((m) => !m.completed_at && m.target_date && monthOf(m.target_date) <= next);
  const nextActions = rankNextActions(s.tasks, todayISO(), 8);
  const openOpps = s.opportunities.filter((o) => OPEN_STAGES.includes(o.stage));
  const risky = s.assets.filter((a) => !a.archived && a.key_risks && (a.risk_level === 'high' || a.risk_level === 'medium'));
  const months = Array.from({ length: 24 }, (_, i) => addMonths(defaultMonth, -i));
  const usedOpex = OPEX_CATEGORIES.filter((c) => p.last.opexByCategory[c]);

  const exportCsv = () => {
    const r: unknown[][] = [];
    const add = (section: string, item: string, metric: string, v: unknown) => r.push([section, item, metric, v]);
    add('Summary', 'Portfolio', 'Revenue', minorToInput(p.last.revenue));
    add('Summary', 'Portfolio', 'Operating expenses', minorToInput(p.last.opex));
    add('Summary', 'Portfolio', 'Operating profit', minorToInput(p.last.profit));
    add('Summary', 'Portfolio', 'Operating margin', p.margin === null ? '' : (p.margin * 100).toFixed(1) + '%');
    add('Summary', 'Portfolio', 'Revenue growth vs prior month', p.revenueGrowth === null ? '' : (p.revenueGrowth * 100).toFixed(1) + '%');
    add('Summary', 'Portfolio', 'Capital invested (cumulative)', minorToInput(invested));
    add('Summary', 'Portfolio', 'Capital invested this month', minorToInput(capitalThisMonth));
    add('Summary', 'Portfolio', 'Estimated portfolio value', value ? minorToInput(value.value) : '');
    add('Summary', 'Portfolio', 'Cash', cash ? minorToInput(cash.total) : '');
    for (const c of usedOpex) add('Expenses', TXN_CATEGORIES[c].label, 'Amount', minorToInput(p.last.opexByCategory[c] ?? 0));
    for (const x of assetRows) {
      add('Assets', x.asset.name, 'Revenue', minorToInput(x.lastMonth.revenue));
      add('Assets', x.asset.name, 'Operating expenses', minorToInput(x.lastMonth.opex));
      add('Assets', x.asset.name, 'Operating profit', minorToInput(x.lastMonth.profit));
      add('Assets', x.asset.name, 'TTM operating profit', minorToInput(x.ttm.profit));
      add('Assets', x.asset.name, 'Capital invested', minorToInput(x.invested));
      add('Assets', x.asset.name, 'Estimated value', x.value === null ? '' : minorToInput(x.value));
    }
    for (const g of goals) {
      const a = goalActual(g, s.transactions, s.metrics, month);
      add('Goals', `${assetName(g.asset_id)}: ${g.title}`, 'Actual / target', `${a ?? ''} / ${g.target_value}`);
    }
    for (const t of completedTasks) add('Completed tasks', t.title, 'Completed', t.completed_at);
    for (const m of achieved) add('Milestones achieved', m.title, 'Achieved', m.completed_at);
    for (const o of openOpps) add('Acquisition pipeline', o.name, OPPORTUNITY_STAGES[o.stage], o.asking_price === null ? '' : minorToInput(o.asking_price));
    if (review?.priorities) add('Priorities next month', 'Review', 'Priorities', review.priorities);
    downloadText(`holding-company-report-${month}.csv`, toCsv(['section', 'item', 'metric', 'value'], r));
  };

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Reports"
          subtitle="A private monthly report built from your records. Print or save as PDF from the print dialog."
          actions={
            <>
              <Select value={month} onChange={setMonth} options={months.map((m) => ({ value: m, label: formatMonth(m, true) }))} />
              <Button icon={<Download size={15} />} onClick={exportCsv}>Export CSV</Button>
              <Button variant="primary" icon={<Printer size={15} />} onClick={() => window.print()}>Print</Button>
            </>
          }
        />
      </div>

      <article className="report">
        <header className="report-head">
          <div>
            <div className="stat-label">{s.settings.company_name} · Private & confidential</div>
            <h1>Monthly report — {formatMonth(month, true)}</h1>
          </div>
          <div className="muted small">Generated {formatDate(todayISO())}</div>
        </header>

        <div className="kpis kpis-4">
          <div className="stat"><div className="stat-label">Revenue</div><div className="stat-value">{money(p.last.revenue, { decimals: false })}</div><div className="stat-sub"><Delta value={p.revenueGrowth} suffix="vs prior month" /></div></div>
          <div className="stat"><div className="stat-label">Operating expenses</div><div className="stat-value">{money(p.last.opex, { decimals: false })}</div></div>
          <div className="stat"><div className="stat-label">Operating profit</div><div className={cx('stat-value', p.last.profit < 0 && 'tone-bad')}>{money(p.last.profit, { decimals: false })}</div><div className="stat-sub">{formatPct(p.margin)} margin · <Delta value={p.profitGrowth} /></div></div>
          <div className="stat"><div className="stat-label">Net cash flow</div><div className="stat-value">{money(p.last.netCashFlow, { decimals: false })}</div><div className="stat-sub">After capital & owner flows</div></div>
          <div className="stat"><div className="stat-label">Capital invested</div><div className="stat-value">{money(invested, { decimals: false })}</div><div className="stat-sub">{money(capitalThisMonth, { decimals: false })} deployed this month</div></div>
          <div className="stat"><div className="stat-label">Est. portfolio value</div><div className="stat-value">{value ? money(value.value, { decimals: false }) : '—'}</div><div className="stat-sub">Your recorded estimates</div></div>
          <div className="stat"><div className="stat-label">Cash</div><div className="stat-value">{cash ? money(cash.total, { decimals: false }) : '—'}</div><div className="stat-sub">{cash ? `Latest by ${formatDate(end)}` : 'Not recorded'}</div></div>
          <div className="stat"><div className="stat-label">TTM operating profit</div><div className="stat-value">{money(p.ttm.profit, { decimals: false })}</div><div className="stat-sub">{formatPct(margin(p.ttm.revenue, p.ttm.profit))} margin</div></div>
        </div>

        <section>
          <h2>Revenue, expenses and operating profit</h2>
          <CashflowChart data={p.monthly} currency={s.settings.currency} height={230} animate={false} />
        </section>

        <section>
          <h2>Performance by asset</h2>
          {assetRows.length ? (
            <table className="table compact">
              <thead><tr><th>Asset</th><th className="num">Revenue</th><th className="num">Expenses</th><th className="num">Op. profit</th><th className="num">MoM</th><th className="num">TTM profit</th><th className="num">Invested</th><th className="num">Est. value</th></tr></thead>
              <tbody>
                {assetRows.map((x) => (
                  <tr key={x.assetId}>
                    <td className="cell-main">{x.asset.name}</td>
                    <td className="num">{money(x.lastMonth.revenue, { decimals: false })}</td>
                    <td className="num">{money(x.lastMonth.opex, { decimals: false })}</td>
                    <td className={cx('num', x.lastMonth.profit < 0 && 'tone-bad')}>{money(x.lastMonth.profit, { decimals: false })}</td>
                    <td className="num"><Delta value={x.revenueGrowth} /></td>
                    <td className="num">{money(x.ttm.profit, { decimals: false })}</td>
                    <td className="num">{money(x.invested, { decimals: false })}</td>
                    <td className="num">{x.value !== null ? money(x.value, { decimals: false }) : '—'}</td>
                  </tr>
                ))}
                {holding.count > 0 && (
                  <tr><td className="subtle">Holding company (unallocated)</td><td className="num">{money(holding.revenue, { decimals: false })}</td><td className="num">{money(holding.opex, { decimals: false })}</td><td className="num">{money(holding.profit, { decimals: false })}</td><td colSpan={4} /></tr>
                )}
              </tbody>
            </table>
          ) : <p className="muted">No asset activity recorded.</p>}
        </section>

        <div className="grid grid-2">
          <section>
            <h2>Operating expenses by category</h2>
            {usedOpex.length ? (
              <table className="table compact"><tbody>
                {usedOpex.map((c) => <tr key={c}><td>{TXN_CATEGORIES[c].label}</td><td className="num">{money(p.last.opexByCategory[c] ?? 0, { decimals: false })}</td><td className="num muted">{formatPct((p.last.opexByCategory[c] ?? 0) / (p.last.opex || 1), 0)}</td></tr>)}
              </tbody></table>
            ) : <p className="muted">No expenses recorded this month.</p>}
          </section>
          <section>
            <h2>Progress against objectives</h2>
            {goals.length ? (
              <table className="table compact"><tbody>
                {goals.map((g) => {
                  const a = goalActual(g, s.transactions, s.metrics, month);
                  const pr = goalProgress(a, g.target_value);
                  const isMoney = g.metric === 'monthly_revenue' || g.metric === 'monthly_profit';
                  const f = (v: number | null) => (v === null ? '—' : isMoney ? money(v, { decimals: false }) : formatNumber(v, 1));
                  return <tr key={g.id}><td><div>{g.title}</div><div className="cell-sub">{assetName(g.asset_id)} · {GOAL_METRICS[g.metric]}</div></td><td className="num">{f(a)} / {f(g.target_value)}</td><td className="num">{pr === null ? '—' : `${Math.round(pr * 100)}%`}</td></tr>;
                })}
              </tbody></table>
            ) : <p className="muted">No active goals.</p>}
          </section>
          <section>
            <h2>Completed this month</h2>
            {completedTasks.length || achieved.length || completedProjects.length ? (
              <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
                {achieved.map((m) => <li key={`m${m.id}`}><b>Milestone:</b> {m.title} <span className="muted">({assetName(m.asset_id)})</span></li>)}
                {completedProjects.map((pr) => <li key={`p${pr.id}`}><b>Project:</b> {pr.name}</li>)}
                {completedTasks.map((t) => <li key={`t${t.id}`}>{t.title} <span className="muted">({assetName(t.asset_id)})</span></li>)}
              </ul>
            ) : <p className="muted">Nothing marked complete in this month.</p>}
          </section>
          <section>
            <h2>Major risks</h2>
            {p.warnings.length || risky.length ? (
              <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
                {p.warnings.map((w, i) => <li key={`w${i}`}><b>{w.title}.</b> {w.detail}</li>)}
                {risky.map((a) => <li key={`r${a.id}`}><b>{a.name}</b> ({a.risk_level} risk): {a.key_risks}</li>)}
              </ul>
            ) : <p className="muted">No risks flagged.</p>}
          </section>
          <section>
            <h2>Acquisition opportunities</h2>
            {openOpps.length ? (
              <table className="table compact"><tbody>
                {openOpps.map((o) => <tr key={o.id}><td>{o.name}</td><td className="subtle">{OPPORTUNITY_STAGES[o.stage]}</td><td className="num">{money(o.asking_price, { decimals: false })}</td></tr>)}
              </tbody></table>
            ) : <p className="muted">No open opportunities.</p>}
          </section>
          <section>
            <h2>Priorities for {formatMonth(next, true)}</h2>
            {review?.priorities ? <p className="prose">{review.priorities}</p> : <p className="muted small">Write priorities in Performance → Monthly review to include them here.</p>}
            {(nextMilestones.length > 0 || nextActions.length > 0) && (
              <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.8 }}>
                {nextMilestones.map((m) => <li key={`m${m.id}`}><b>Milestone:</b> {m.title} — {formatDate(m.target_date)}</li>)}
                {nextActions.slice(0, 5).map((t) => <li key={`t${t.id}`}>{t.title}{t.deadline ? ` — ${formatDate(t.deadline)}` : ''}</li>)}
              </ul>
            )}
          </section>
        </div>

        {review && (review.improved || review.underperformed || review.learned || review.fix || review.stop) && (
          <section>
            <h2>Monthly review</h2>
            <div className="grid grid-2">
              {([['What improved', review.improved], ['What performed poorly', review.underperformed], ['What I learned', review.learned], ['What needs fixing', review.fix], ['What to stop doing', review.stop]] as const).filter(([, v]) => v).map(([k, v]) => (
                <div key={k}><div className="stat-label" style={{ marginBottom: 4 }}>{k}</div><p className="prose small">{v}</p></div>
              ))}
            </div>
          </section>
        )}
        <p className="muted small mt-lg">All figures are calculated from recorded transactions, valuations and balances. Estimated values are the owner’s own estimates. Capital invested includes purchase prices and capital transactions; it is not an expense.</p>
      </article>
    </>
  );
}
