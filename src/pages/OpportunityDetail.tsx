import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Pencil, Plus, Trash2, BadgeCheck } from 'lucide-react';
import { api, invalidateAll, useList, usePatch, useRemove, useSave, useSnapshot } from '../lib/api';
import { cx, formatNumber, useCurrency, useMoney } from '../lib/format';
import { useForm, moneyFields, numOrNull } from '../lib/form';
import { ASSET_CATEGORIES, OPPORTUNITY_STAGES } from '../../shared/domain';
import { addMonths, formatMonth, todayISO } from '../../shared/dates';
import { formatPct, minorToInput } from '../../shared/money';
import { ttmFromHistory } from '../../shared/valuation';
import type { OppFinancial } from '../../shared/types';
import { OpportunityForm } from '../components/OpportunityForm';
import { ValuationCalculator } from '../components/ValuationCalculator';
import { LinkedKnowledge } from '../components/knowledge';
import { CashflowChart } from '../components/charts';
import { Badge, Button, Checkbox, Empty, ErrorBox, Field, FormGrid, FormModal, Input, Loading, MoneyInput, Panel, Select, Stat, Tabs, useConfirm, useToast } from '../components/ui';

type Tab = 'overview' | 'financials' | 'valuation' | 'knowledge';

export function OpportunityDetail() {
  const id = Number(useParams().id);
  const { data: s, isLoading, error } = useSnapshot();
  const { data: fins = [] } = useList('opp-financials', { opportunity_id: id });
  const patch = usePatch('opportunities');
  const money = useMoney();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const opp = s?.opportunities.find((o) => o.id === id);
  if (!s || !opp) return <Empty title="Opportunity not found" action={<Link className="link" to="/acquisitions">Back to pipeline</Link>} />;
  const ttm = ttmFromHistory(fins);
  const mult = ttm && opp.asking_price && ttm.annualisedProfit > 0 ? opp.asking_price / ttm.annualisedProfit : null;

  const remove = async () => {
    if (!(await confirm({ title: `Delete ${opp.name}?`, body: 'Its financial history is deleted too. Linked notes and documents are kept.', danger: true, confirmLabel: 'Delete' }))) return;
    await api(`/api/opportunities/${opp.id}`, { method: 'DELETE' });
    await invalidateAll();
    navigate('/acquisitions');
  };

  return (
    <>
      <Link to="/acquisitions" className="link small row gap-xs" style={{ marginBottom: 12, display: 'inline-flex' }}><ArrowLeft size={13} /> Acquisitions</Link>
      <div className="asset-hero">
        <div className="grow">
          <div className="row gap-sm wrap"><h1>{opp.name}</h1>{opp.converted_asset_id && <Link to={`/assets/${opp.converted_asset_id}`}><Badge tone="good">Now an owned asset →</Badge></Link>}</div>
          <div className="subtle small row gap-sm wrap" style={{ marginTop: 4 }}>
            <span>{ASSET_CATEGORIES[opp.category]}</span>
            {opp.source && <>·<span>via {opp.source}</span></>}
            {opp.website && <>·<a href={opp.website} target="_blank" rel="noreferrer noopener" className="link row gap-xs">{opp.website.replace(/^https?:\/\//, '')} <ExternalLink size={12} /></a></>}
          </div>
        </div>
        <div className="row gap-sm">
          <Select value={opp.stage} onChange={(st) => patch.mutate({ id: opp.id, data: { stage: st } }, { onSuccess: () => toast(`Moved to ${OPPORTUNITY_STAGES[st]}`) })} options={OPPORTUNITY_STAGES} aria-label="Stage" />
          {!opp.converted_asset_id && opp.stage !== 'rejected' && <Button icon={<BadgeCheck size={14} />} onClick={() => setConverting(true)}>Mark acquired</Button>}
          <Button icon={<Pencil size={14} />} onClick={() => setEditing(true)}>Edit</Button>
          <Button variant="ghost" icon={<Trash2 size={14} />} onClick={remove} aria-label="Delete" title="Delete" />
        </div>
      </div>

      <div className="kpis">
        <Stat label="Asking price" value={money(opp.asking_price, { decimals: false })} sub={mult !== null ? `${mult.toFixed(2)}× annual profit` : undefined} />
        <Stat label="Revenue (TTM)" value={ttm ? money(ttm.revenue, { decimals: false }) : '—'} sub={ttm ? `${ttm.months} months reported` : 'No history'} />
        <Stat label="Profit (annualised)" value={ttm ? money(ttm.annualisedProfit, { decimals: false }) : '—'} sub={ttm ? (ttm.verifiedMonths === ttm.months ? <span className="verified-tag">verified</span> : <span className="estimate-tag">{ttm.verifiedMonths}/{ttm.months} verified</span>) : undefined} />
        <Stat label="Your estimated value" value={money(opp.estimated_value, { decimals: false })} sub={<span className="estimate-tag">estimate</span>} />
        <Stat label="Max you'd pay" value={money(opp.max_price, { decimals: false })} sub={opp.max_price && opp.asking_price ? (opp.asking_price > opp.max_price ? <span className="tone-bad">Asking is {money(opp.asking_price - opp.max_price, { decimals: false })} above</span> : <span className="tone-good">Asking within limit</span>) : undefined} />
        <Stat label="Yield at asking" value={ttm && opp.asking_price ? formatPct(ttm.annualisedProfit / opp.asking_price) : '—'} sub={opp.target_return_pct !== null ? `Target ${opp.target_return_pct}%` : undefined} />
      </div>

      <Tabs<Tab> value={tab} onChange={(t) => setParams({ tab: t })} tabs={[
        { key: 'overview', label: 'Overview & diligence' },
        { key: 'financials', label: 'Financial history', count: fins.length || undefined },
        { key: 'valuation', label: 'Valuation calculator' },
        { key: 'knowledge', label: 'Notes & documents' },
      ]} />

      {tab === 'overview' && (
        <div className="grid grid-2">
          <TextPanel title="Business model" text={opp.business_model} />
          <TextPanel title="Audience & traffic" text={opp.audience} />
          <TextPanel title="Main growth opportunities" text={opp.growth_opportunities} />
          <TextPanel title="Key risks" text={opp.risks} />
          <div className="span-all"><TextPanel title="Due diligence notes" text={opp.dd_notes} /></div>
          {opp.stage === 'rejected' && <div className="span-all"><TextPanel title="Why rejected" text={opp.rejected_reason} /></div>}
        </div>
      )}
      {tab === 'financials' && <FinancialHistory oppId={opp.id} rows={fins} currency={s.settings.currency} />}
      {tab === 'valuation' && <ValuationCalculator opp={opp} financials={fins} />}
      {tab === 'knowledge' && <LinkedKnowledge opportunityId={opp.id} />}

      {editing && <OpportunityForm opp={opp} onClose={() => setEditing(false)} />}
      {converting && <ConvertForm oppId={opp.id} defaultPrice={opp.asking_price} onClose={() => setConverting(false)} onDone={(assetId) => navigate(`/assets/${assetId}`)} />}
    </>
  );
}

function TextPanel({ title, text }: { title: string; text: string | null }) {
  return <Panel title={title}>{text ? <p className="prose">{text}</p> : <span className="muted small">Not recorded</span>}</Panel>;
}

function FinancialHistory({ oppId, rows, currency }: { oppId: number; rows: OppFinancial[]; currency: string }) {
  const money = useMoney();
  const remove = useRemove('opp-financials');
  const [editing, setEditing] = useState<OppFinancial | 'new' | null>(null);
  const sorted = [...rows].sort((a, b) => a.period.localeCompare(b.period));
  const chart = sorted.map((r) => ({ month: r.period, revenue: r.revenue, opex: r.revenue - r.profit, profit: r.profit }));
  return (
    <div className="grid">
      <Panel title="Reported performance" sub="Expenses shown as revenue − profit">
        <CashflowChart data={chart} currency={currency} height={240} />
      </Panel>
      <Panel pad={false} title="Monthly figures" sub="Mark a month verified only once you have checked it against source data (bank, Stripe, analytics)." actions={<Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setEditing('new')}>Month</Button>}>
        {rows.length ? (
          <table className="table compact">
            <thead><tr><th>Month</th><th className="num">Revenue</th><th className="num">Profit</th><th className="num">Margin</th><th className="num">Traffic</th><th>Status</th><th>Notes</th><th /></tr></thead>
            <tbody>
              {[...sorted].reverse().map((r) => (
                <tr key={r.id}>
                  <td>{formatMonth(r.period, true)}</td>
                  <td className="num">{money(r.revenue)}</td>
                  <td className={cx('num', r.profit < 0 && 'tone-bad')}>{money(r.profit)}</td>
                  <td className="num">{r.revenue > 0 ? formatPct(r.profit / r.revenue, 0) : '—'}</td>
                  <td className="num">{formatNumber(r.traffic)}</td>
                  <td>{r.verified ? <span className="verified-tag">verified</span> : <span className="estimate-tag">seller-reported</span>}</td>
                  <td className="subtle small ellipsis" style={{ maxWidth: 220 }}>{r.notes}</td>
                  <td className="actions"><span className="row-actions">
                    <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEditing(r)} aria-label="Edit" />
                    <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => remove.mutate({ id: r.id })} aria-label="Delete" />
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty compact title="No figures recorded" action={<Button onClick={() => setEditing('new')}>Add a month</Button>} />}
      </Panel>
      {editing && <FinancialForm oppId={oppId} row={editing === 'new' ? undefined : editing} latest={sorted[sorted.length - 1]?.period} onClose={() => setEditing(null)} />}
    </div>
  );
}

function FinancialForm({ oppId, row, latest, onClose }: { oppId: number; row?: OppFinancial; latest?: string; onClose: () => void }) {
  const save = useSave('opp-financials');
  const currency = useCurrency();
  const f = useForm({ period: row?.period ?? (latest ? addMonths(latest, 1) : addMonths(todayISO().slice(0, 7), -1)), revenue: minorToInput(row?.revenue), profit: minorToInput(row?.profit), traffic: row?.traffic?.toString() ?? '', verified: row?.verified ?? false, notes: row?.notes ?? '' });
  const v = f.values;
  const submit = (again: boolean) => {
    const m = moneyFields(v, ['revenue', 'profit'], ['revenue', 'profit']);
    if (!m.ok) return f.setErrors(m.errors);
    save.mutateAsync({ id: row?.id, data: { ...v, opportunity_id: oppId, revenue: m.out.revenue, profit: m.out.profit, traffic: numOrNull(v.traffic) } }).then(() => {
      if (again) f.setValues((x) => ({ ...x, period: addMonths(x.period, 1), revenue: '', profit: '', traffic: '', notes: '' }));
      else onClose();
    }, f.handleError);
  };
  return (
    <FormModal title={row ? 'Edit month' : 'Add month'} onClose={onClose} onSubmit={() => submit(false)} saving={save.isPending} error={f.formError} width={540}
      extraActions={!row && <button type="button" className="btn btn-ghost btn-sm" onClick={() => submit(true)}>Save & next month</button>}>
      <FormGrid cols={2}>
        <Field label="Month" error={f.errors.period}>{(id) => <Input id={id} type="month" value={v.period} onChange={(x) => f.set('period', x)} />}</Field>
        <Field label="Traffic / audience" hint="Optional (visits, subscribers…)">{(id) => <Input id={id} inputMode="numeric" value={v.traffic} onChange={(x) => f.set('traffic', x)} />}</Field>
        <Field label="Revenue" error={f.errors.revenue}>{(id) => <MoneyInput id={id} currency={currency} value={v.revenue} onChange={(x) => f.set('revenue', x)} autoFocus />}</Field>
        <Field label="Profit" error={f.errors.profit} hint="Negative for a loss">{(id) => <MoneyInput id={id} currency={currency} value={v.profit} onChange={(x) => f.set('profit', x)} />}</Field>
        <Field label="Notes" span={2}>{(id) => <Input id={id} value={v.notes} onChange={(x) => f.set('notes', x)} />}</Field>
        <div className="span-2"><Checkbox checked={v.verified} onChange={(x) => f.set('verified', x)} label="I have verified this month against source data" /></div>
      </FormGrid>
    </FormModal>
  );
}

function ConvertForm({ oppId, defaultPrice, onClose, onDone }: { oppId: number; defaultPrice: number | null; onClose: () => void; onDone: (assetId: number) => void }) {
  const currency = useCurrency();
  const toast = useToast();
  const f = useForm({ price: minorToInput(defaultPrice), date: todayISO(), busy: false });
  const submit = async () => {
    const m = moneyFields(f.values, ['price']);
    if (!m.ok) return f.setErrors(m.errors);
    f.set('busy', true);
    try {
      const r = await api<{ assetId: number }>(`/api/opportunities/${oppId}/convert`, { method: 'POST', json: { price: m.out.price, date: f.values.date } });
      await invalidateAll();
      toast('Created a new owned asset from this opportunity');
      onDone(r.assetId);
    } catch (e) {
      f.handleError(e);
      f.set('busy', false);
    }
  };
  return (
    <FormModal title="Mark as acquired" onClose={onClose} onSubmit={submit} saving={f.values.busy} error={f.formError} width={500} submitLabel="Create asset">
      <p className="subtle small" style={{ marginBottom: 14 }}>Creates an owned asset with this purchase price (counted as capital invested and recorded as its first valuation) and moves linked notes and documents to it. Record fees separately as “Acquisition costs”.</p>
      <FormGrid cols={2}>
        <Field label="Purchase price paid" error={f.errors.price}>{(id) => <MoneyInput id={id} currency={currency} value={f.values.price} onChange={(x) => f.set('price', x)} />}</Field>
        <Field label="Completion date" error={f.errors.date}>{(id) => <Input id={id} type="date" value={f.values.date} onChange={(x) => f.set('date', x)} />}</Field>
      </FormGrid>
    </FormModal>
  );
}
