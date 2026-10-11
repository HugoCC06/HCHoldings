import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { api, invalidateAll } from '../lib/api';
import { cx, useCurrency, useMoney } from '../lib/format';
import { parseMoney, minorToInput, formatPct } from '../../shared/money';
import { DEFAULT_ASSUMPTIONS, SCENARIOS, dcf, irr, maxPriceForYield, multipleValuation, returnAtPrice, ttmFromHistory, type ScenarioKey } from '../../shared/valuation';
import type { Assumptions } from '../../shared/schemas';
import type { OppFinancial, Opportunity } from '../../shared/types';
import { Button, MoneyInput, Panel, Textarea, useToast } from './ui';

type ScenarioField = 'multiple' | 'growthPct' | 'discountPct' | 'years' | 'exitMultiple';
const FIELDS: { key: ScenarioField; label: string; hint: string; step: number }[] = [
  { key: 'multiple', label: 'Profit multiple', hint: '× annual profit', step: 0.1 },
  { key: 'growthPct', label: 'Annual profit growth', hint: '% per year', step: 1 },
  { key: 'discountPct', label: 'Discount rate', hint: '% required return', step: 1 },
  { key: 'years', label: 'Holding period', hint: 'years', step: 1 },
  { key: 'exitMultiple', label: 'Exit multiple', hint: '× final-year profit', step: 0.1 },
];

export function ValuationCalculator({ opp, financials }: { opp: Opportunity; financials: OppFinancial[] }) {
  const money = useMoney();
  const currency = useCurrency();
  const toast = useToast();
  const [a, setA] = useState<Assumptions>(opp.assumptions ?? DEFAULT_ASSUMPTIONS);
  const [overrideText, setOverrideText] = useState(minorToInput(opp.assumptions?.annualProfitOverride ?? null));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setA(opp.assumptions ?? DEFAULT_ASSUMPTIONS);
    setOverrideText(minorToInput(opp.assumptions?.annualProfitOverride ?? null));
  }, [opp.id, opp.assumptions]);

  const ttm = ttmFromHistory(financials);
  const override = overrideText.trim() ? parseMoney(overrideText) : null;
  const profit = override ?? ttm?.annualisedProfit ?? null;
  const price = opp.asking_price;
  const dirty = JSON.stringify({ ...a, annualProfitOverride: override }) !== JSON.stringify(opp.assumptions ?? DEFAULT_ASSUMPTIONS);

  const results = useMemo(() => {
    if (profit === null) return null;
    return Object.fromEntries(
      SCENARIOS.map(({ key }) => {
        const sc = a[key];
        const d = dcf(profit, sc);
        return [key, {
          multiple: multipleValuation(profit, sc.multiple),
          dcf: d,
          ret: price ? returnAtPrice(price, profit) : null,
          irr: price ? irr(price, profit, sc) : null,
        }];
      }),
    ) as Record<ScenarioKey, { multiple: number; dcf: ReturnType<typeof dcf>; ret: ReturnType<typeof returnAtPrice> | null; irr: number | null }>;
  }, [a, profit, price]);

  const setField = (sc: ScenarioKey, k: ScenarioField, v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    setA((x) => ({ ...x, [sc]: { ...x[sc], [k]: k === 'years' ? Math.max(1, Math.min(15, Math.round(n))) : n } }));
  };

  const save = async (alsoEstimate?: number) => {
    if (overrideText.trim() && override === null) return toast('Annual profit override is not a valid amount', 'bad');
    setSaving(true);
    try {
      await api(`/api/opportunities/${opp.id}`, { method: 'PATCH', json: { assumptions: { ...a, annualProfitOverride: override }, ...(alsoEstimate !== undefined ? { estimated_value: alsoEstimate } : {}) } });
      await invalidateAll();
      toast(alsoEstimate !== undefined ? 'Assumptions saved and estimate updated' : 'Assumptions saved');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setSaving(false);
    }
  };

  const yieldTarget = opp.target_return_pct;
  return (
    <div className="grid">
      <Panel title="Valuation basis" sub="Every assumption below is editable and saved with the opportunity.">
        <div className="grid grid-3">
          <div>
            <div className="stat-label">Annual profit from history</div>
            <div className="stat-value">{ttm ? money(ttm.annualisedProfit, { decimals: false }) : '—'}</div>
            <div className="stat-sub">
              {ttm ? <>{ttm.months < 12 ? `Annualised from ${ttm.months} months` : 'Last 12 months'} · {ttm.verifiedMonths === ttm.months ? <span className="verified-tag">verified</span> : <span className="estimate-tag">{ttm.verifiedMonths}/{ttm.months} months verified</span>}</> : 'Add monthly figures in the Financials tab'}
            </div>
          </div>
          <div>
            <div className="stat-label">Override annual profit</div>
            <div style={{ marginTop: 6, maxWidth: 220 }}><MoneyInput currency={currency} value={overrideText} onChange={setOverrideText} placeholder="Use history" /></div>
            <div className="stat-sub">e.g. normalised for owner salary or one-offs</div>
          </div>
          <div>
            <div className="stat-label">Asking price</div>
            <div className="stat-value">{money(price, { decimals: false })}</div>
            <div className="stat-sub">{price && profit && profit > 0 ? `${(price / profit).toFixed(2)}× annual profit` : '—'}</div>
          </div>
        </div>
      </Panel>

      <Panel title="Scenarios" pad={false} actions={
        <>
          <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => { setA(DEFAULT_ASSUMPTIONS); setOverrideText(''); }}>Defaults</Button>
          <Button size="sm" variant="primary" icon={<Save size={14} />} loading={saving} disabled={!dirty} onClick={() => save()}>Save assumptions</Button>
        </>
      }>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Assumption</th>{SCENARIOS.map((s) => <th key={s.key} className="num">{s.label}</th>)}</tr>
            </thead>
            <tbody>
              {FIELDS.map((f) => (
                <tr key={f.key}>
                  <td><div className="cell-main">{f.label}</div><div className="cell-sub">{f.hint}</div></td>
                  {SCENARIOS.map((s) => (
                    <td key={s.key} className="num">
                      <input className="input" style={{ width: 96, textAlign: 'right' }} type="number" step={f.step} value={a[s.key][f.key]} onChange={(e) => setField(s.key, f.key, e.target.value)} aria-label={`${s.label} ${f.label}`} />
                    </td>
                  ))}
                </tr>
              ))}
              {results ? (
                <>
                  <tr><td colSpan={4} className="form-section" style={{ paddingTop: 16 }}>Outputs (estimates)</td></tr>
                  <OutRow label="Value: profit × multiple" values={SCENARIOS.map((s) => money(results[s.key].multiple, { decimals: false }))} />
                  <OutRow label="Value: discounted cash flow" sub="PV of profits + PV of exit" values={SCENARIOS.map((s) => money(results[s.key].dcf.total, { decimals: false }))} />
                  <OutRow label="  of which exit value (PV)" values={SCENARIOS.map((s) => money(results[s.key].dcf.pvExit, { decimals: false }))} muted />
                  <OutRow label="Asking vs DCF value" values={SCENARIOS.map((s) => (price ? <span className={cx(price > results[s.key].dcf.total ? 'tone-bad' : 'tone-good')}>{price > results[s.key].dcf.total ? 'Above' : 'Below'} by {money(Math.abs(price - results[s.key].dcf.total), { decimals: false })}</span> : '—'))} />
                  <OutRow label="Expected return (IRR at asking)" sub="Profits + exit over holding period" values={SCENARIOS.map((s) => formatPct(results[s.key].irr))} />
                  <OutRow label="Year-1 cash yield at asking" values={SCENARIOS.map((s) => formatPct(results[s.key].ret?.yield ?? null))} />
                  <OutRow label="Simple payback at asking" values={SCENARIOS.map((s) => (results[s.key].ret?.paybackYears ? `${results[s.key].ret!.paybackYears!.toFixed(1)} yrs` : '—'))} />
                  {yieldTarget !== null && <OutRow label={`Max price for ${yieldTarget}% yield`} values={SCENARIOS.map(() => money(maxPriceForYield(profit!, yieldTarget), { decimals: false }))} />}
                  <tr>
                    <td className="subtle small">Use as your estimated value</td>
                    {SCENARIOS.map((s) => (
                      <td key={s.key} className="num"><Button size="sm" onClick={() => save(results[s.key].dcf.total)}>Use DCF</Button></td>
                    ))}
                  </tr>
                </>
              ) : (
                <tr><td colSpan={4}><div className="empty empty-compact">Add financial history or an annual profit override to calculate values.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Assumption notes">
        <Textarea rows={3} value={a.notes} onChange={(v) => setA((x) => ({ ...x, notes: v }))} placeholder="Why these multiples and growth rates? Comparable sales, broker guidance, risks priced in…" />
      </Panel>
    </div>
  );
}

function OutRow({ label, sub, values, muted }: { label: string; sub?: string; values: React.ReactNode[]; muted?: boolean }) {
  return (
    <tr>
      <td className={cx(muted && 'subtle')} style={muted ? { paddingLeft: 24 } : undefined}><div className={cx(!muted && 'cell-main')}>{label.trim()}</div>{sub && <div className="cell-sub">{sub}</div>}</td>
      {values.map((v, i) => <td key={i} className={cx('num', !muted && 'cell-main', muted && 'subtle')}>{v}</td>)}
    </tr>
  );
}
