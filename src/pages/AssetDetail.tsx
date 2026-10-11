import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowLeft, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { api, invalidateAll, useSnapshot } from '../lib/api';
import { useMoney } from '../lib/format';
import { ApiError } from '../lib/api';
import { ASSET_CATEGORIES, ASSET_ORIGINS, ASSET_STATUSES, LEVELS } from '../../shared/domain';
import { addMonths, formatDate, formatMonth, monthRange, todayISO } from '../../shared/dates';
import { lastCompleteMonth, monthlyTotals, latestValuation } from '../../shared/finance';
import { assetPerformance } from '../../shared/insights';
import { formatPct } from '../../shared/money';
import { AssetForm } from '../components/AssetForm';
import { CashflowChart } from '../components/charts';
import { TransactionsTable } from '../components/TransactionsTable';
import { ValuationsPanel } from '../components/ValuationsPanel';
import { ProfitAndLoss } from './Finance';
import { STATUS_TONE } from './Assets';
import { AssetLogo, Badge, Button, Delta, Empty, ErrorBox, Loading, Panel, Stat, Tabs, useConfirm, useToast } from '../components/ui';
import { AssetWorkTab, AssetKnowledgeTab, AssetGoalsTab } from '../components/AssetTabs';

type Tab = 'overview' | 'finance' | 'pnl' | 'valuations' | 'work' | 'goals' | 'knowledge';

export function AssetDetail() {
  const { id } = useParams();
  const assetId = Number(id);
  const { data: s, isLoading, error } = useSnapshot();
  const money = useMoney();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const [editing, setEditing] = useState(false);

  const asset = s?.assets.find((a) => a.id === assetId);
  const end = lastCompleteMonth(todayISO());
  const perf = useMemo(() => (s && asset ? assetPerformance(asset, s.transactions, s.valuations, end) : null), [s, asset, end]);
  const monthly = useMemo(() => {
    if (!s || !asset) return [];
    const txns = s.transactions.filter((t) => t.asset_id === asset.id);
    return monthlyTotals(txns, monthRange(addMonths(end, -11), end));
  }, [s, asset, end]);

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!s || !asset || !perf) return <Empty title="Asset not found" action={<Link className="link" to="/assets">Back to assets</Link>} />;

  const currentValue = latestValuation(s.valuations, asset.id);
  const openTasks = s.tasks.filter((t) => t.asset_id === asset.id && t.status !== 'completed').length;

  const toggleArchive = async () => {
    await api(`/api/assets/${asset.id}`, { method: 'PATCH', json: { archived: !asset.archived } });
    await invalidateAll();
    toast(asset.archived ? 'Asset restored' : 'Asset archived — its history still counts in portfolio totals');
  };
  const remove = async () => {
    const ok = await confirm({ title: `Delete ${asset.name}?`, body: 'This permanently deletes the asset with its valuations, goals and metrics. Linked tasks, projects and notes are kept but unlinked. Consider archiving instead.', danger: true, confirmLabel: 'Delete asset' });
    if (!ok) return;
    try {
      await api(`/api/assets/${asset.id}`, { method: 'DELETE' });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) return toast((e as Error).message, 'bad');
      const again = await confirm({ title: 'Also delete financial history?', body: `${e.message} Deleting will remove these transactions from all portfolio figures.`, danger: true, confirmLabel: 'Delete asset and transactions' });
      if (!again) return;
      await api(`/api/assets/${asset.id}?withTransactions=1`, { method: 'DELETE' });
    }
    await invalidateAll();
    toast('Asset deleted');
    navigate('/assets');
  };

  return (
    <>
      <Link to="/assets" className="link small row gap-xs" style={{ marginBottom: 12, display: 'inline-flex' }}><ArrowLeft size={13} /> Assets</Link>
      <div className="asset-hero">
        <AssetLogo name={asset.name} logo={asset.logo} size={52} />
        <div className="grow">
          <div className="row gap-sm wrap">
            <h1>{asset.name}</h1>
            <Badge tone={STATUS_TONE[asset.status]}>{ASSET_STATUSES[asset.status]}</Badge>
            {asset.archived && <Badge>Archived</Badge>}
          </div>
          <div className="subtle small row gap-sm wrap" style={{ marginTop: 4 }}>
            <span>{ASSET_CATEGORIES[asset.category]}</span>·<span>{ASSET_ORIGINS[asset.origin]}{asset.start_date ? ` ${formatDate(asset.start_date)}` : ''}</span>
            {asset.url && (<>·<a href={asset.url} target="_blank" rel="noreferrer noopener" className="link row gap-xs">{asset.url.replace(/^https?:\/\//, '')} <ExternalLink size={12} /></a></>)}
          </div>
        </div>
        <div className="row gap-sm">
          <Button icon={<Pencil size={14} />} onClick={() => setEditing(true)}>Edit</Button>
          <Button icon={asset.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />} onClick={toggleArchive}>{asset.archived ? 'Restore' : 'Archive'}</Button>
          <Button variant="ghost" icon={<Trash2 size={14} />} onClick={remove} aria-label="Delete" title="Delete" />
        </div>
      </div>

      <div className="kpis">
        <Stat label={`Revenue · ${formatMonth(end)}`} value={money(perf.lastMonth.revenue, { decimals: false })} sub={<Delta value={perf.revenueGrowth} suffix="MoM" />} />
        <Stat label={`Op. profit · ${formatMonth(end)}`} value={money(perf.lastMonth.profit, { decimals: false })} tone={perf.lastMonth.profit < 0 ? 'bad' : undefined} />
        <Stat label="TTM operating profit" value={money(perf.ttm.profit, { decimals: false })} sub={`${formatPct(perf.margin)} margin`} />
        <Stat label="Capital invested" value={money(perf.invested, { decimals: false })} sub={asset.acquisition_price ? `incl. ${money(asset.acquisition_price, { decimals: false })} purchase` : 'Capital transactions'} />
        <Stat label="Est. value" value={currentValue ? money(currentValue.value, { decimals: false }) : '—'} sub={currentValue ? <>as of {formatDate(currentValue.date)} <span className="estimate-tag">estimate</span></> : 'Not valued'} />
        <Stat label="ROIC" value={perf.roic ? formatPct(perf.roic.value) : '—'} sub={perf.roic?.annualised ? `Annualised (${perf.ttm.monthsCovered} mo)` : perf.roic ? 'TTM' : 'Insufficient data'} hint="Trailing-12-month operating profit ÷ capital invested" />
        <Stat label="Total gain" value={perf.totalGain !== null ? money(perf.totalGain, { decimals: false }) : '—'} tone={perf.totalGain !== null && perf.totalGain < 0 ? 'bad' : undefined} sub="Value + cumulative profit − invested" />
      </div>

      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'finance', label: 'Transactions' },
          { key: 'pnl', label: 'Profit & loss' },
          { key: 'valuations', label: 'Valuations' },
          { key: 'work', label: 'Projects & tasks', count: openTasks || undefined },
          { key: 'goals', label: 'Goals & metrics' },
          { key: 'knowledge', label: 'Notes & documents' },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid grid-main">
          <Panel title="Monthly performance" sub="Last 12 complete months">
            <CashflowChart data={monthly} currency={s.settings.currency} height={250} />
          </Panel>
          <Panel title="Profile">
            <dl className="kv">
              <dt>Business model</dt><dd>{asset.business_model ?? <span className="muted">—</span>}</dd>
              <dt>Revenue model</dt><dd>{asset.revenue_model ?? <span className="muted">—</span>}</dd>
              <dt>Risk level</dt><dd>{asset.risk_level ? LEVELS[asset.risk_level] : <span className="muted">Not assessed</span>}</dd>
              <dt>Growth potential</dt><dd>{asset.growth_potential ? LEVELS[asset.growth_potential] : <span className="muted">Not assessed</span>}</dd>
              <dt>Time required</dt><dd>{asset.weekly_hours !== null ? `${asset.weekly_hours} h / week` : <span className="muted">—</span>}</dd>
              <dt>Cumulative op. profit</dt><dd>{money(perf.cumulativeProfit)}</dd>
            </dl>
          </Panel>
          <Panel title="Description & objectives">
            {asset.description || asset.objectives ? (
              <div className="stack gap-md">
                {asset.description && <p className="prose">{asset.description}</p>}
                {asset.objectives && (<div><div className="stat-label" style={{ marginBottom: 6 }}>Strategic objectives</div><p className="prose">{asset.objectives}</p></div>)}
              </div>
            ) : <Empty compact title="No description yet" action={<Button size="sm" onClick={() => setEditing(true)}>Add details</Button>} />}
          </Panel>
          <Panel title="Risks, issues & notes">
            {asset.key_risks || asset.notes ? (
              <div className="stack gap-md">
                {asset.key_risks && (<div><div className="stat-label" style={{ marginBottom: 6 }}>Key risks</div><p className="prose">{asset.key_risks}</p></div>)}
                {asset.notes && (<div><div className="stat-label" style={{ marginBottom: 6 }}>Notes</div><p className="prose">{asset.notes}</p></div>)}
              </div>
            ) : <Empty compact title="Nothing recorded" />}
          </Panel>
        </div>
      )}
      {tab === 'finance' && <TransactionsTable assetId={asset.id} />}
      {tab === 'pnl' && <ProfitAndLoss assetId={asset.id} />}
      {tab === 'valuations' && <ValuationsPanel assetId={asset.id} valuations={s.valuations} />}
      {tab === 'work' && <AssetWorkTab assetId={asset.id} />}
      {tab === 'goals' && <AssetGoalsTab assetId={asset.id} />}
      {tab === 'knowledge' && <AssetKnowledgeTab assetId={asset.id} />}

      {editing && <AssetForm asset={asset} currentValue={currentValue?.value ?? null} onClose={() => setEditing(false)} />}
    </>
  );
}
