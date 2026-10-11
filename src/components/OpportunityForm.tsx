import { useSave } from '../lib/api';
import { useForm, moneyFields, numOrNull } from '../lib/form';
import { useCurrency } from '../lib/format';
import { ASSET_CATEGORIES, OPPORTUNITY_STAGES } from '../../shared/domain';
import { minorToInput } from '../../shared/money';
import type { Opportunity } from '../../shared/types';
import { Field, FormGrid, FormModal, Input, MoneyInput, Select, Textarea, useToast } from './ui';

export function OpportunityForm({ opp, onClose, onSaved }: { opp?: Opportunity; onClose: () => void; onSaved?: (o: Opportunity) => void }) {
  const save = useSave('opportunities');
  const currency = useCurrency();
  const toast = useToast();
  const f = useForm({
    name: opp?.name ?? '', website: opp?.website ?? '', category: opp?.category ?? 'website', stage: opp?.stage ?? 'idea', source: opp?.source ?? '',
    asking_price: minorToInput(opp?.asking_price), estimated_value: minorToInput(opp?.estimated_value), max_price: minorToInput(opp?.max_price),
    target_return_pct: opp?.target_return_pct?.toString() ?? '', business_model: opp?.business_model ?? '', audience: opp?.audience ?? '',
    growth_opportunities: opp?.growth_opportunities ?? '', risks: opp?.risks ?? '', dd_notes: opp?.dd_notes ?? '', rejected_reason: opp?.rejected_reason ?? '',
  });
  const v = f.values;
  const submit = () => {
    const m = moneyFields(v, ['asking_price', 'estimated_value', 'max_price']);
    if (!m.ok) return f.setErrors(m.errors);
    save
      .mutateAsync({ id: opp?.id, data: { ...v, ...m.out, target_return_pct: numOrNull(v.target_return_pct), assumptions: opp?.assumptions ?? null } })
      .then((o) => { toast(opp ? 'Opportunity updated' : 'Opportunity added'); onSaved?.(o); onClose(); }, f.handleError);
  };
  return (
    <FormModal title={opp ? `Edit ${opp.name}` : 'New acquisition opportunity'} onClose={onClose} onSubmit={submit} saving={save.isPending} error={f.formError} width={760}>
      <FormGrid cols={3}>
        <div className="form-section">Business</div>
        <Field label="Business name" error={f.errors.name} span={2}>{(id) => <Input id={id} value={v.name} onChange={(x) => f.set('name', x)} autoFocus />}</Field>
        <Field label="Stage">{(id) => <Select id={id} value={v.stage} onChange={(x) => f.set('stage', x)} options={OPPORTUNITY_STAGES} />}</Field>
        <Field label="Website" error={f.errors.website} span={2}>{(id) => <Input id={id} value={v.website} onChange={(x) => f.set('website', x)} placeholder="https://" />}</Field>
        <Field label="Category">{(id) => <Select id={id} value={v.category} onChange={(x) => f.set('category', x)} options={ASSET_CATEGORIES} />}</Field>
        <Field label="Business model" span={2}>{(id) => <Input id={id} value={v.business_model} onChange={(x) => f.set('business_model', x)} />}</Field>
        <Field label="Source" hint="Broker, marketplace, direct…">{(id) => <Input id={id} value={v.source} onChange={(x) => f.set('source', x)} />}</Field>

        <div className="form-section">Price</div>
        <Field label="Asking price" error={f.errors.asking_price}>{(id) => <MoneyInput id={id} currency={currency} value={v.asking_price} onChange={(x) => f.set('asking_price', x)} />}</Field>
        <Field label="Your estimated value" error={f.errors.estimated_value} hint="An estimate — use the valuation calculator">{(id) => <MoneyInput id={id} currency={currency} value={v.estimated_value} onChange={(x) => f.set('estimated_value', x)} />}</Field>
        <Field label="Maximum price you'd pay" error={f.errors.max_price}>{(id) => <MoneyInput id={id} currency={currency} value={v.max_price} onChange={(x) => f.set('max_price', x)} />}</Field>
        <Field label="Target annual return (%)" error={f.errors.target_return_pct} hint="Cash yield you require on the price">{(id) => <Input id={id} inputMode="decimal" value={v.target_return_pct} onChange={(x) => f.set('target_return_pct', x)} />}</Field>

        <div className="form-section">Analysis</div>
        <Field label="Audience & traffic" span={3}>{(id) => <Textarea id={id} rows={2} value={v.audience} onChange={(x) => f.set('audience', x)} placeholder="Monthly visitors, subscribers, customers, sources…" />}</Field>
        <Field label="Main growth opportunities" span={3}>{(id) => <Textarea id={id} rows={3} value={v.growth_opportunities} onChange={(x) => f.set('growth_opportunities', x)} />}</Field>
        <Field label="Key risks" span={3}>{(id) => <Textarea id={id} rows={3} value={v.risks} onChange={(x) => f.set('risks', x)} />}</Field>
        <Field label="Due diligence notes" span={3}>{(id) => <Textarea id={id} rows={4} value={v.dd_notes} onChange={(x) => f.set('dd_notes', x)} />}</Field>
        {v.stage === 'rejected' && <Field label="Why rejected" span={3}>{(id) => <Textarea id={id} rows={2} value={v.rejected_reason} onChange={(x) => f.set('rejected_reason', x)} />}</Field>}
      </FormGrid>
    </FormModal>
  );
}
