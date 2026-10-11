import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useSnapshot } from '../lib/api';
import { usePortfolio } from '../lib/portfolio';
import { cx, formatNumber, useMoney } from '../lib/format';
import { ASSET_STATUSES, LEVELS } from '../../shared/domain';
import { formatMonth } from '../../shared/dates';
import { metricTrends } from '../../shared/insights';
import { formatPct } from '../../shared/money';
import type { Goal } from '../../shared/types';
import { GoalForm, GoalsTable, ReviewEditor } from '../components/performance';
import { AssetLogo, Badge, Button, Checkbox, Delta, Empty, ErrorBox, Loading, PageHeader, Panel, Tabs } from '../components/ui';

type Tab = 'compare' | 'goals' | 'review';
type SortKey = 'name' | 'revenue' | 'profit' | 'margin' | 'growth' | 'invested' | 'value' | 'roic' | 'hourly' | 'risk';

export function PerformancePage() {
  const { data: s, isLoading, error } = useSnapshot();
  const p = usePortfolio(s);
  const money = useMoney();
  const [tab, setTab] = useState<Tab>('compare');
  const [includeAll, setIncludeAll] = useState(false);
  const [sort, setSort] = useState<SortKey>('profit');
  const [goalEdit, setGoalEdit] = useState<Goal | 'new' | null>(null);

  const rows = useMemo(() => {
    if (!s || !p) return [];
    const riskRank = { low: 0, medium: 1, high: 2 } as const;
    return p.perf
      .filter((x) => includeAll || (!x.asset.archived && x.asset.status !== 'idea' && x.asset.status !== 'sold'))
      .map((x) => {
        const hours = x.asset.weekly_hours;
        const hourly = hours && hours > 0 && x.ttm.monthsCovered ? (x.ttm.profit / x.ttm.monthsCovered) * 12 / (hours * 52) : null;
        const audience = metricTrends(s.metrics, x.assetId)[0] ?? null;
        return { ...x, hourly, audience, riskRank: x.asset.risk_level ? riskRank[x.asset.risk_level] : null };
      })
      .sort((a, b) => {
        const key: Record<SortKey, (r: typeof a) => number | string | null> = {
          name: (r) => r.asset.name, revenue: (r) => r.lastMonth.revenue, profit: (r) => r.ttm.profit, margin: (r) => r.margin, growth: (r) => r.revenueGrowth,
          invested: (r) => r.invested, value: (r) => r.value, roic: (r) => r.roic?.value ?? null, hourly: (r) => r.hourly, risk: (r) => r.riskRank,
        };
        const va = key[sort](a);
        const vb = key[sort](b);
        if (va === null) return 1;
        if (vb === null) return -1;
        if (typeof va === 'string') return va.localeCompare(vb as string);
        return sort === 'risk' ? (va as number) - (vb as number) : (vb as number) - (va as number);
      });
  }, [s, p, includeAll, sort]);

  if (isLoading) return <Loading />;
  if (error || !s || !p) return <ErrorBox error={error} />;
  const th = (k: SortKey, label: string, num = true, title?: string) => (
    <th className={cx('sortable', num && 'num')} onClick={() => setSort(k)} title={title}>{label}{sort === k ? ' ↓' : ''}</th>
  );

  return (
    <>
      <PageHeader title="Performance & decisions" subtitle="Compare assets on returns, risk, capital and time — not on revenue alone." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ key: 'compare', label: 'Compare assets' }, { key: 'goals', label: 'Goals', count: s.goals.filter((g) => g.status === 'active').length }, { key: 'review', label: 'Monthly review' }]} />

      {tab === 'compare' && (
        <>
          <div className="filters">
            <Checkbox checked={includeAll} onChange={setIncludeAll} label="Include ideas, sold and archived assets" />
            <div className="grow" />
            <span className="muted small">Monthly figures: {formatMonth(p.endMonth, true)}. Click a column to sort.</span>
          </div>
          <Panel pad={false}>
            {rows.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      {th('name', 'Asset', false)}
                      {th('revenue', 'Revenue (mo)')}
                      {th('profit', 'Op. profit (TTM)')}
                      {th('margin', 'Margin')}
                      {th('growth', 'Rev. growth', true, 'Last month vs the month before')}
                      {th('invested', 'Invested')}
                      {th('value', 'Est. value')}
                      {th('roic', 'ROIC', true, 'TTM operating profit ÷ capital invested. * = annualised from <12 months')}
                      <th>Audience</th>
                      {th('hourly', 'Profit / hour', true, 'Annualised operating profit ÷ (hours per week × 52)')}
                      {th('risk', 'Risk', false)}
                      <th>Growth potential</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.assetId}>
                        <td style={{ minWidth: 210 }}>
                          <Link to={`/assets/${r.assetId}`} className="row gap-sm">
                            <AssetLogo name={r.asset.name} logo={r.asset.logo} size={24} />
                            <div><div className="cell-main">{r.asset.name}</div><div className="cell-sub">{ASSET_STATUSES[r.asset.status]}{r.asset.weekly_hours !== null ? ` · ${r.asset.weekly_hours} h/wk` : ''}</div></div>
                          </Link>
                        </td>
                        <td className="num">{money(r.lastMonth.revenue, { decimals: false })}</td>
                        <td className={cx('num', r.ttm.profit < 0 && 'tone-bad')}>{money(r.ttm.profit, { decimals: false })}</td>
                        <td className="num">{formatPct(r.margin, 0)}</td>
                        <td className="num"><Delta value={r.revenueGrowth} /></td>
                        <td className="num">{money(r.invested, { decimals: false })}</td>
                        <td className="num">{r.value !== null ? money(r.value, { decimals: false }) : '—'}</td>
                        <td className="num">{r.roic ? `${formatPct(r.roic.value, 0)}${r.roic.annualised ? '*' : ''}` : '—'}</td>
                        <td>{r.audience ? <><div>{formatNumber(r.audience.latest)} <span className="muted small">{r.audience.name}</span></div><div className="cell-sub"><Delta value={r.audience.change} /></div></> : <span className="muted">—</span>}</td>
                        <td className="num">{r.hourly !== null ? money(Math.round(r.hourly), { decimals: false }) : '—'}</td>
                        <td>{r.asset.risk_level ? <Badge tone={r.asset.risk_level === 'high' ? 'bad' : r.asset.risk_level === 'medium' ? 'warn' : 'good'}>{LEVELS[r.asset.risk_level]}</Badge> : <span className="muted small">—</span>}</td>
                        <td>{r.asset.growth_potential ? LEVELS[r.asset.growth_potential] : <span className="muted small">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty title="No operating or in-development assets to compare" />}
          </Panel>
          <div className="grid grid-2 mt-md">
            <Panel title="Risks & operational issues">
              {rows.filter((r) => r.asset.key_risks).length ? (
                <div className="list">
                  {rows.filter((r) => r.asset.key_risks).map((r) => (
                    <div className="list-item" key={r.assetId} style={{ alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 140 }} className="cell-main">{r.asset.name}</div>
                      <div className="prose small grow">{r.asset.key_risks}</div>
                    </div>
                  ))}
                </div>
              ) : <Empty compact title="No risks recorded">Add key risks on each asset to compare them here.</Empty>}
            </Panel>
            <Panel title="How to read this">
              <ul className="subtle small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
                <li><b>ROIC</b> shows how hard invested capital is working; it is blank when capital or profit data is missing.</li>
                <li><b>Profit per hour</b> uses the weekly time you estimate on each asset — set it to compare where your time pays off.</li>
                <li><b>Estimated values</b> are your own dated estimates and are never inferred.</li>
                <li>Weigh growth potential, risk and capital needs alongside the numbers; nothing here is ranked automatically.</li>
              </ul>
            </Panel>
          </div>
        </>
      )}

      {tab === 'goals' && (
        <Panel pad={false} title="Goals across the portfolio" sub={`Revenue and profit goals compare against ${formatMonth(p.endMonth, true)}`} actions={<Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setGoalEdit('new')} disabled={!s.assets.length}>Goal</Button>}>
          <div style={{ paddingTop: 10 }}><GoalsTable goals={s.goals} onEdit={setGoalEdit} /></div>
        </Panel>
      )}

      {tab === 'review' && <ReviewEditor />}
      {goalEdit && <GoalForm goal={goalEdit === 'new' ? undefined : goalEdit} onClose={() => setGoalEdit(null)} />}
    </>
  );
}
