import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ExternalLink, Plus } from 'lucide-react';
import { useSnapshot } from '../lib/api';
import { usePortfolio } from '../lib/portfolio';
import { useMoney } from '../lib/format';
import { ASSET_CATEGORIES, ASSET_STATUSES, type AssetStatus } from '../../shared/domain';
import { formatDate } from '../../shared/dates';
import { formatPct } from '../../shared/money';
import { AssetForm } from '../components/AssetForm';
import { AssetLogo, Badge, Button, Empty, ErrorBox, Input, Loading, PageHeader, Panel, Select, Tabs } from '../components/ui';

type TabKey = 'owned' | 'development' | 'ideas' | 'archived' | 'all';
const TAB_FILTER: Record<TabKey, (s: AssetStatus, archived: boolean) => boolean> = {
  owned: (s, a) => !a && (s === 'operating' || s === 'paused'),
  development: (s, a) => !a && s === 'development',
  ideas: (s, a) => !a && s === 'idea',
  archived: (s, a) => a || s === 'sold',
  all: () => true,
};
export const STATUS_TONE: Record<AssetStatus, 'good' | 'info' | 'neutral' | 'warn' | 'accent'> = { operating: 'good', development: 'info', idea: 'accent', paused: 'warn', sold: 'neutral' };

export function AssetsPage() {
  const { data: s, isLoading, error } = useSnapshot();
  const p = usePortfolio(s);
  const money = useMoney();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>('owned');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const creating = params.get('new') === '1';

  const rows = useMemo(() => {
    if (!s || !p) return [];
    return p.perf
      .filter((x) => TAB_FILTER[tab](x.asset.status, x.asset.archived) || (tab === 'archived' && x.asset.archived))
      .filter((x) => !category || x.asset.category === category)
      .filter((x) => !q || `${x.asset.name} ${x.asset.description ?? ''} ${x.asset.business_model ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  }, [s, p, tab, q, category]);

  if (isLoading) return <Loading />;
  if (error || !s || !p) return <ErrorBox error={error} />;
  const count = (k: TabKey) => s.assets.filter((a) => TAB_FILTER[k](a.status, a.archived)).length;

  return (
    <>
      <PageHeader
        title="Assets"
        subtitle="Everything you own, are building, or are considering."
        actions={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setParams({ new: '1' })}>New asset</Button>}
      />
      <Tabs<TabKey>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'owned', label: 'Owned & operating', count: count('owned') },
          { key: 'development', label: 'In development', count: count('development') },
          { key: 'ideas', label: 'Ideas', count: count('ideas') },
          { key: 'archived', label: 'Archived & sold', count: count('archived') },
          { key: 'all', label: 'All', count: s.assets.length },
        ]}
      />
      <div className="filters">
        <Input className="search-input" placeholder="Filter by name or description…" value={q} onChange={setQ} />
        <Select value={category} onChange={setCategory} options={ASSET_CATEGORIES} placeholder="All categories" />
      </div>
      <Panel pad={false}>
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Asset</th><th>Category</th><th>Status</th><th>Since</th>
                  <th className="num">Monthly revenue</th><th className="num">TTM profit</th><th className="num">Margin</th>
                  <th className="num">Invested</th><th className="num">Est. value</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ asset: a, ...x }) => (
                  <tr key={a.id} className="clickable" onClick={() => navigate(`/assets/${a.id}`)}>
                    <td>
                      <div className="row gap-md">
                        <AssetLogo name={a.name} logo={a.logo} />
                        <div style={{ minWidth: 0 }}>
                          <div className="cell-main">{a.name}</div>
                          <div className="cell-sub ellipsis" style={{ maxWidth: 280 }}>{a.description ?? a.business_model ?? ''}</div>
                        </div>
                      </div>
                    </td>
                    <td className="subtle">{ASSET_CATEGORIES[a.category]}</td>
                    <td>
                      <div className="row gap-xs">
                        <Badge tone={STATUS_TONE[a.status]}>{ASSET_STATUSES[a.status]}</Badge>
                        {a.archived && <Badge>Archived</Badge>}
                      </div>
                    </td>
                    <td className="subtle">{formatDate(a.start_date)}</td>
                    <td className="num">{money(x.lastMonth.revenue, { decimals: false })}</td>
                    <td className="num">{money(x.ttm.profit, { decimals: false })}</td>
                    <td className="num">{formatPct(x.margin, 0)}</td>
                    <td className="num">{money(x.invested, { decimals: false })}</td>
                    <td className="num">{x.value !== null ? money(x.value, { decimals: false }) : '—'}</td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      {a.url && (
                        <a href={a.url} target="_blank" rel="noreferrer noopener" className="btn btn-ghost btn-sm btn-icon" title="Open website">
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : s.assets.length ? (
          <Empty title="No assets match these filters" />
        ) : (
          <Empty title="No assets yet" action={<Button variant="primary" onClick={() => setParams({ new: '1' })}>Add your first asset</Button>}>
            Add websites, SaaS products, newsletters, games, apps and ideas you’re considering.
          </Empty>
        )}
      </Panel>
      <p className="cell-sub mt-md">
        Monthly revenue is for the last complete month. TTM = trailing twelve months. <Link className="link" to="/performance">Compare assets in depth →</Link>
      </p>
      {creating && <AssetForm onClose={() => setParams({})} onSaved={(a) => navigate(`/assets/${a.id}`)} />}
    </>
  );
}
