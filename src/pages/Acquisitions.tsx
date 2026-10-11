import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Columns3, List, Plus } from 'lucide-react';
import { useList, usePatch, useSnapshot } from '../lib/api';
import { cx, useMoney } from '../lib/format';
import { OPEN_STAGES, OPPORTUNITY_STAGES, ASSET_CATEGORIES, type OpportunityStage } from '../../shared/domain';
import { ttmFromHistory } from '../../shared/valuation';
import { OpportunityForm } from '../components/OpportunityForm';
import { Badge, Button, Empty, ErrorBox, Loading, PageHeader, Panel, Segmented, Stat } from '../components/ui';

const STAGES = Object.keys(OPPORTUNITY_STAGES) as OpportunityStage[];

export function AcquisitionsPage() {
  const { data: s, isLoading, error } = useSnapshot();
  const { data: fins = [] } = useList('opp-financials');
  const patch = usePatch('opportunities');
  const money = useMoney();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'pipeline' | 'table'>('pipeline');
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<OpportunityStage | null>(null);
  const ttm = useMemo(() => {
    const m = new Map<number, ReturnType<typeof ttmFromHistory>>();
    for (const o of s?.opportunities ?? []) m.set(o.id, ttmFromHistory(fins.filter((f) => f.opportunity_id === o.id)));
    return m;
  }, [s, fins]);
  if (isLoading) return <Loading />;
  if (error || !s) return <ErrorBox error={error} />;
  const opps = s.opportunities;
  const open = opps.filter((o) => OPEN_STAGES.includes(o.stage));
  const multiple = (id: number, price: number | null) => {
    const t = ttm.get(id);
    return t && price && t.annualisedProfit > 0 ? price / t.annualisedProfit : null;
  };

  return (
    <>
      <PageHeader
        title="Acquisitions"
        subtitle="Private pipeline of businesses you might buy. Figures marked unverified come from sellers and have not been checked."
        actions={
          <>
            <Segmented value={view} onChange={setView} options={[{ key: 'pipeline', label: 'Pipeline', icon: <Columns3 size={14} /> }, { key: 'table', label: 'Table', icon: <List size={14} /> }]} />
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => setParams({ new: '1' })}>Opportunity</Button>
          </>
        }
      />
      <div className="kpis">
        <Stat label="Open opportunities" value={open.length} />
        <Stat label="Total asking (open)" value={money(open.reduce((x, o) => x + (o.asking_price ?? 0), 0), { decimals: false })} />
        <Stat label="In due diligence / offer" value={open.filter((o) => o.stage === 'due_diligence' || o.stage === 'offer').length} />
        <Stat label="Acquired" value={opps.filter((o) => o.stage === 'acquired').length} />
        <Stat label="Rejected" value={opps.filter((o) => o.stage === 'rejected').length} />
      </div>

      {!opps.length ? (
        <Panel><Empty title="No opportunities yet" action={<Button variant="primary" onClick={() => setParams({ new: '1' })}>Add an opportunity</Button>}>Track websites, SaaS products, newsletters and other assets you are evaluating.</Empty></Panel>
      ) : view === 'pipeline' ? (
        <div className="pipeline">
          {STAGES.map((st) => {
            const col = opps.filter((o) => o.stage === st);
            return (
              <div key={st} className={cx('kanban-col', over === st && 'drag-over')} onDragOver={(e) => { e.preventDefault(); setOver(st); }} onDragLeave={() => setOver(null)}
                onDrop={() => { setOver(null); if (dragId !== null) patch.mutate({ id: dragId, data: { stage: st } }); setDragId(null); }}>
                <div className="kanban-head"><span>{OPPORTUNITY_STAGES[st]} <span className="muted">{col.length}</span></span></div>
                <div className="kanban-body">
                  {col.map((o) => {
                    const t = ttm.get(o.id);
                    const mult = multiple(o.id, o.asking_price);
                    return (
                      <div key={o.id} className={cx('card', dragId === o.id && 'dragging')} draggable onDragStart={() => setDragId(o.id)} onDragEnd={() => setDragId(null)} onClick={() => navigate(`/acquisitions/${o.id}`)}>
                        <div className="card-title">{o.name}</div>
                        <div className="cell-sub">{ASSET_CATEGORIES[o.category]}</div>
                        <div className="card-meta" style={{ justifyContent: 'space-between' }}>
                          <span>Asking <b style={{ color: 'var(--text)' }}>{o.asking_price !== null ? money(o.asking_price, { compact: true }) : '—'}</b></span>
                          {mult !== null && <span title="Asking price ÷ annualised profit">{mult.toFixed(1)}×</span>}
                        </div>
                        {t && <div className="card-meta"><span>Profit (annualised) {money(t.annualisedProfit, { compact: true })}</span>{t.verifiedMonths < t.months ? <span className="estimate-tag">{t.verifiedMonths}/{t.months} verified</span> : <span className="verified-tag">verified</span>}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Panel pad={false}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Business</th><th>Stage</th><th className="num">Asking</th><th className="num">Annualised profit</th><th className="num">Multiple</th><th className="num">Your estimate</th><th className="num">Max price</th></tr></thead>
              <tbody>
                {opps.map((o) => {
                  const t = ttm.get(o.id);
                  const mult = multiple(o.id, o.asking_price);
                  return (
                    <tr key={o.id} className="clickable" onClick={() => navigate(`/acquisitions/${o.id}`)}>
                      <td><div className="cell-main">{o.name}</div><div className="cell-sub">{o.business_model ?? ASSET_CATEGORIES[o.category]}</div></td>
                      <td><Badge tone={o.stage === 'acquired' ? 'good' : o.stage === 'rejected' ? 'neutral' : 'accent'}>{OPPORTUNITY_STAGES[o.stage]}</Badge></td>
                      <td className="num">{money(o.asking_price, { decimals: false })}</td>
                      <td className="num">{t ? money(t.annualisedProfit, { decimals: false }) : '—'}{t && t.verifiedMonths < t.months && <div className="cell-sub">{t.verifiedMonths}/{t.months} mo verified</div>}</td>
                      <td className="num">{mult !== null ? `${mult.toFixed(1)}×` : '—'}</td>
                      <td className="num">{money(o.estimated_value, { decimals: false })}</td>
                      <td className="num">{money(o.max_price, { decimals: false })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      <p className="cell-sub mt-md">Drag cards between stages. Open an opportunity to record financial history and run the valuation calculator.</p>
      {params.get('new') === '1' && <OpportunityForm onClose={() => setParams({})} onSaved={(o) => navigate(`/acquisitions/${o.id}`)} />}
    </>
  );
}
