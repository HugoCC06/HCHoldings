import { Link, useNavigate } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, ArrowRight, Info, Plus } from 'lucide-react';
import { useSnapshot } from '../lib/api';
import { usePortfolio } from '../lib/portfolio';
import { useMoney } from '../lib/format';
import { formatDate, formatMonth, todayISO, addDays, daysBetween } from '../../shared/dates';
import { formatPct } from '../../shared/money';
import { rankNextActions, isOverdue } from '../../shared/insights';
import { ASSET_STATUSES, OPEN_STAGES, OPPORTUNITY_STAGES, PRIORITIES } from '../../shared/domain';
import { Badge, Button, Delta, Empty, ErrorBox, Loading, PageHeader, Panel, Stat } from '../components/ui';
import { BarList, CashflowChart, PortfolioChart, RevenueByAssetChart } from '../components/charts';
import { cx } from '../lib/format';

export function Dashboard() {
  const { data: s, isLoading, error } = useSnapshot();
  const p = usePortfolio(s);
  const money = useMoney();
  const navigate = useNavigate();
  if (isLoading) return <Loading />;
  if (error || !s || !p) return <ErrorBox error={error} />;

  const today = todayISO();
  const active = s.assets.filter((a) => !a.archived);
  const owned = active.filter((a) => a.status === 'operating' || a.status === 'paused');
  const developing = active.filter((a) => a.status === 'development');
  const ideas = active.filter((a) => a.status === 'idea');
  const nextActions = rankNextActions(s.tasks, today, 7);
  const overdue = s.tasks.filter((t) => isOverdue(t, today)).length;
  const horizon = addDays(today, 45);
  const upcomingMilestones = s.milestones.filter((m) => !m.completed_at && m.target_date && m.target_date <= horizon).slice(0, 6);
  const openOpps = s.opportunities.filter((o) => OPEN_STAGES.includes(o.stage));
  const assetName = (id: number | null) => (id ? s.assets.find((a) => a.id === id)?.name : null) ?? 'Holding company';
  const label = formatMonth(p.endMonth, true);
  const empty = s.assets.length === 0 && !p.hasData;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={<>Figures for <b>{label}</b> (last complete month) unless stated. All values are calculated from your records.</>}
        actions={
          <>
            <Button icon={<Plus size={15} />} onClick={() => navigate('/finance?new=1')}>Transaction</Button>
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/assets?new=1')}>Asset</Button>
          </>
        }
      />

      {empty && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          <Info size={16} />
          <div>
            <b>Welcome.</b> Start by <Link className="link" to="/assets?new=1">adding your first asset</Link>, then record revenue and expenses in{' '}
            <Link className="link" to="/finance">Finance</Link> (or import a CSV). Every metric below fills in from what you record — nothing is estimated for you.
          </div>
        </div>
      )}

      <div className="kpis kpis-4">
        <Stat label="Owned assets" value={owned.length} sub={`${developing.length} in development · ${ideas.length} ideas`} />
        <Stat label="Monthly revenue" value={money(p.last.revenue, { decimals: false })} sub={<Delta value={p.revenueGrowth} suffix="vs prior month" />} />
        <Stat label="Monthly expenses" value={money(p.last.opex, { decimals: false })} sub={<span className="muted">Operating costs only</span>} />
        <Stat label="Operating profit" value={money(p.last.profit, { decimals: false })} tone={p.last.profit < 0 ? 'bad' : undefined} sub={<>{p.margin !== null ? `${formatPct(p.margin)} margin · ` : ''}<Delta value={p.profitGrowth} /></>} />
        <Stat label="Capital invested" value={money(p.invested, { decimals: false })} sub="Purchase prices + capital spend" />
        <Stat
          label="Est. portfolio value"
          value={p.value ? money(p.value.value, { decimals: false }) : '—'}
          sub={p.value ? <span>{p.value.assetsValued} asset{p.value.assetsValued > 1 ? 's' : ''} valued <span className="estimate-tag">estimate</span></span> : 'No valuations recorded'}
        />
        <Stat
          label="Cash"
          value={p.cash ? money(p.cash.total, { decimals: false }) : '—'}
          sub={p.cash ? `As of ${formatDate(p.cash.oldestDate)}` : 'No balances recorded'}
          tone={p.cash && p.cash.total < 0 ? 'bad' : undefined}
        />
        <Stat
          label="Return on capital"
          value={p.roic ? formatPct(p.roic.value) : '—'}
          sub={p.roic ? (p.roic.annualised ? `Annualised from ${p.ttm.monthsCovered} mo` : 'Trailing 12 months') : 'Needs capital & profit data'}
          hint="Trailing-12-month operating profit ÷ capital invested"
        />
      </div>

      <div className="grid grid-main">
        <Panel title="Revenue, expenses & operating profit" sub={`Monthly · ${formatMonth(p.months[0])} – ${formatMonth(p.endMonth)}`}>
          <CashflowChart data={p.monthly} currency={s.settings.currency} />
        </Panel>
        <Panel title="Attention" sub={`${p.warnings.length} item${p.warnings.length === 1 ? '' : 's'}`}>
          {p.warnings.length ? (
            <div className="list">
              {p.warnings.slice(0, 7).map((w, i) => (
                <div className="warning-item" key={i}>
                  {w.level === 'critical' ? <AlertOctagon size={16} className="tone-bad" /> : w.level === 'warning' ? <AlertTriangle size={16} className="tone-warn" /> : <Info size={16} style={{ color: 'var(--info)' }} />}
                  <div className="grow">
                    <div style={{ fontWeight: 500 }}>{w.link ? <Link to={w.link}>{w.title}</Link> : w.title}</div>
                    <div className="cell-sub">{w.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty compact title="Nothing needs attention">Warnings appear here for overdue work, falling revenue, losses, concentration and low cash cover.</Empty>
          )}
        </Panel>

        <Panel title="Revenue contribution by asset" sub="Monthly, stacked">
          <RevenueByAssetChart data={p.revenueByMonth} series={p.revenueSeries} currency={s.settings.currency} />
        </Panel>
        <Panel title="Next actions" sub={overdue ? `${overdue} overdue` : 'Ranked by urgency and priority'} actions={<Link to="/work" className="link small">All tasks</Link>}>
          {nextActions.length ? (
            <div className="list">
              {nextActions.map((t) => (
                <Link to={`/work?task=${t.id}`} className="list-item" key={t.id}>
                  <span className="dot" style={{ background: t.priority === 'critical' ? 'var(--bad)' : t.priority === 'high' ? 'var(--warn)' : 'var(--muted)' }} title={PRIORITIES[t.priority]} />
                  <div className="grow">
                    <div className="ellipsis">{t.title}</div>
                    <div className="cell-sub">{assetName(t.asset_id)}</div>
                  </div>
                  {t.deadline && <span className={cx('small', isOverdue(t, today) ? 'tone-bad' : 'muted')}>{formatDate(t.deadline)}</span>}
                </Link>
              ))}
            </div>
          ) : (
            <Empty compact title="No open tasks" action={<Link className="link" to="/work?new=1">Create a task</Link>} />
          )}
        </Panel>

        <Panel title="Portfolio value & capital invested" sub="Month-end. Values are your recorded estimates.">
          <PortfolioChart data={p.series} currency={s.settings.currency} />
        </Panel>
        <Panel title="Upcoming milestones" sub="Next 45 days and overdue">
          {upcomingMilestones.length ? (
            <div className="list">
              {upcomingMilestones.map((m) => {
                const d = daysBetween(today, m.target_date!);
                return (
                  <div className="list-item" key={m.id}>
                    <div className="grow">
                      <div className="ellipsis">{m.title}</div>
                      <div className="cell-sub">{assetName(m.asset_id)}</div>
                    </div>
                    <Badge tone={d < 0 ? 'bad' : d <= 7 ? 'warn' : 'neutral'}>{d < 0 ? `${-d}d late` : d === 0 ? 'Today' : `in ${d}d`}</Badge>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty compact title="No milestones due soon" />
          )}
        </Panel>

        <Panel title="Capital invested by asset" sub="Purchase price + capital transactions">
          <BarList
            items={p.perf.filter((x) => x.invested > 0).sort((a, b) => b.invested - a.invested).map((x) => ({ key: x.assetId, label: <Link to={`/assets/${x.assetId}`}>{x.asset.name}</Link>, value: x.invested, color: p.colorOf(x.assetId) }))}
            format={(v) => money(v, { compact: true })}
            empty={<Empty compact title="No capital recorded yet">Add acquisition prices to assets or record investments.</Empty>}
          />
        </Panel>
        <Panel title="Revenue concentration" sub="Share of trailing-12-month revenue">
          <BarList
            items={p.conc.shares.slice(0, 8).map((x) => ({ key: x.assetId ?? 'h', label: assetName(x.assetId), value: x.revenue, color: p.colorOf(x.assetId), sub: formatPct(x.share, 0) }))}
            format={(v) => money(v, { compact: true })}
            empty={<Empty compact title="No revenue in the last 12 months" />}
          />
          {p.conc.hhi !== null && p.conc.shares.length > 1 && (
            <div className="cell-sub mt-md">
              Concentration index {p.conc.hhi.toFixed(2)} (1.00 = all revenue from one asset).
            </div>
          )}
        </Panel>

        <Panel title="Asset performance" sub={`${label} · sorted by operating profit`} className="span-all" pad={false} actions={<Link to="/performance" className="link small">Compare in depth</Link>}>
          {active.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Asset</th><th>Status</th><th className="num">Revenue</th><th className="num">Op. profit</th><th className="num">Growth</th>
                    <th className="num">TTM profit</th><th className="num">Invested</th><th className="num">Est. value</th><th className="num">ROIC</th>
                  </tr>
                </thead>
                <tbody>
                  {p.perf.filter((x) => !x.asset.archived).sort((a, b) => b.lastMonth.profit - a.lastMonth.profit).map((x) => (
                    <tr key={x.assetId} className="clickable" onClick={() => navigate(`/assets/${x.assetId}`)}>
                      <td><div className="row gap-sm"><span className="dot" style={{ background: p.colorOf(x.assetId) }} /><span className="cell-main">{x.asset.name}</span></div></td>
                      <td><Badge tone={x.asset.status === 'operating' ? 'good' : x.asset.status === 'development' ? 'info' : 'neutral'}>{ASSET_STATUSES[x.asset.status]}</Badge></td>
                      <td className="num">{money(x.lastMonth.revenue, { decimals: false })}</td>
                      <td className={cx('num', x.lastMonth.profit < 0 && 'tone-bad')}>{money(x.lastMonth.profit, { decimals: false })}</td>
                      <td className="num"><Delta value={x.revenueGrowth} /></td>
                      <td className="num">{money(x.ttm.profit, { decimals: false })}</td>
                      <td className="num">{money(x.invested, { decimals: false })}</td>
                      <td className="num">{x.value !== null ? money(x.value, { decimals: false }) : '—'}</td>
                      <td className="num">{x.roic ? `${formatPct(x.roic.value, 0)}${x.roic.annualised ? '*' : ''}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No assets yet" action={<Button variant="primary" onClick={() => navigate('/assets?new=1')}>Add an asset</Button>} />
          )}
        </Panel>

        <Panel title="Acquisition pipeline" sub={`${openOpps.length} open opportunit${openOpps.length === 1 ? 'y' : 'ies'}`} className="span-all" actions={<Link to="/acquisitions" className="link small">Open pipeline <ArrowRight size={12} /></Link>}>
          {openOpps.length ? (
            <div className="list">
              {openOpps.slice(0, 6).map((o) => (
                <Link to={`/acquisitions/${o.id}`} className="list-item" key={o.id}>
                  <div className="grow">
                    <div className="ellipsis cell-main">{o.name}</div>
                    <div className="cell-sub">{o.business_model ?? '—'}</div>
                  </div>
                  <Badge tone="accent">{OPPORTUNITY_STAGES[o.stage]}</Badge>
                  <div className="num" style={{ minWidth: 110 }}>
                    <div>{o.asking_price !== null ? money(o.asking_price, { decimals: false }) : '—'}</div>
                    <div className="cell-sub">asking</div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <Empty compact title="No open opportunities" action={<Link className="link" to="/acquisitions?new=1">Add an opportunity</Link>} />
          )}
        </Panel>
      </div>
    </>
  );
}
