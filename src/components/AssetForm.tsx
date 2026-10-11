import { useRef } from 'react';
import { Upload, X } from 'lucide-react';
import { api, invalidateAll } from '../lib/api';
import { useForm, moneyFields, numOrNull } from '../lib/form';
import { useCurrency } from '../lib/format';
import { ASSET_CATEGORIES, ASSET_ORIGINS, ASSET_STATUSES, LEVELS } from '../../shared/domain';
import { minorToInput } from '../../shared/money';
import { todayISO } from '../../shared/dates';
import type { Asset } from '../../shared/types';
import { AssetLogo, Button, Field, FormGrid, FormModal, Input, MoneyInput, Select, Textarea, useToast } from './ui';

/** Downscale an image file to a small square data URL for use as a logo. */
async function fileToLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Could not read that image'));
      i.src = url;
    });
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const scale = Math.max(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function AssetForm({ asset, currentValue, onClose, onSaved }: { asset?: Asset; currentValue?: number | null; onClose: () => void; onSaved?: (a: Asset) => void }) {
  const currency = useCurrency();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const f = useForm({
    name: asset?.name ?? '',
    logo: asset?.logo ?? null,
    url: asset?.url ?? '',
    category: asset?.category ?? 'saas',
    status: asset?.status ?? 'development',
    origin: asset?.origin ?? 'built',
    start_date: asset?.start_date ?? '',
    acquisition_price: minorToInput(asset?.acquisition_price),
    current_value: minorToInput(currentValue ?? null),
    business_model: asset?.business_model ?? '',
    revenue_model: asset?.revenue_model ?? '',
    description: asset?.description ?? '',
    objectives: asset?.objectives ?? '',
    notes: asset?.notes ?? '',
    risk_level: asset?.risk_level ?? '',
    key_risks: asset?.key_risks ?? '',
    growth_potential: asset?.growth_potential ?? '',
    weekly_hours: asset?.weekly_hours?.toString() ?? '',
    saving: false,
  });
  const v = f.values;

  const submit = async () => {
    const m = moneyFields(v, ['acquisition_price', 'current_value']);
    if (!m.ok) return f.setErrors(m.errors);
    f.set('saving', true);
    try {
      const data = {
        name: v.name, logo: v.logo, url: v.url, category: v.category, status: v.status, origin: v.origin,
        start_date: v.start_date || null, acquisition_price: v.origin === 'acquired' ? m.out.acquisition_price : null,
        business_model: v.business_model, revenue_model: v.revenue_model, description: v.description, objectives: v.objectives,
        notes: v.notes, risk_level: v.risk_level || null, key_risks: v.key_risks, growth_potential: v.growth_potential || null,
        weekly_hours: numOrNull(v.weekly_hours), archived: asset?.archived ?? false,
      };
      const saved = await api<Asset>(asset ? `/api/assets/${asset.id}` : '/api/assets', { method: asset ? 'PUT' : 'POST', json: data });
      // Record a new valuation only when the estimate actually changed.
      if (m.out.current_value !== null && m.out.current_value !== (currentValue ?? null)) {
        await api('/api/valuations', { method: 'POST', json: { asset_id: saved.id, date: todayISO(), value: m.out.current_value, method: 'Manual estimate' } });
      }
      await invalidateAll();
      toast(asset ? 'Asset updated' : 'Asset created');
      onSaved?.(saved);
      onClose();
    } catch (e) {
      f.handleError(e);
    } finally {
      f.set('saving', false);
    }
  };

  return (
    <FormModal title={asset ? `Edit ${asset.name}` : 'New asset'} onClose={onClose} onSubmit={submit} saving={v.saving} error={f.formError} width={760}>
      <FormGrid cols={3}>
        <div className="form-section">Identity</div>
        <Field label="Name" error={f.errors.name} span={2}>{(id) => <Input id={id} value={v.name} onChange={(x) => f.set('name', x)} placeholder="e.g. Acme Analytics" />}</Field>
        <Field label="Logo">
          {() => (
            <div className="row gap-sm">
              <AssetLogo name={v.name || '?'} logo={v.logo} size={34} />
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try { f.set('logo', await fileToLogo(file)); } catch (err) { f.setErrors({ logo: (err as Error).message }); }
                e.target.value = '';
              }} />
              <Button size="sm" type="button" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>Upload</Button>
              {v.logo && <Button size="sm" variant="ghost" type="button" icon={<X size={14} />} onClick={() => f.set('logo', null)} aria-label="Remove logo" />}
            </div>
          )}
        </Field>
        <Field label="Website URL" error={f.errors.url} span={2}>{(id) => <Input id={id} value={v.url} onChange={(x) => f.set('url', x)} placeholder="https://" />}</Field>
        <Field label="Category">{(id) => <Select id={id} value={v.category} onChange={(x) => f.set('category', x)} options={ASSET_CATEGORIES} />}</Field>
        <Field label="Status" hint="Ideas and in-development projects are kept separate from owned assets">{(id) => <Select id={id} value={v.status} onChange={(x) => f.set('status', x)} options={ASSET_STATUSES} />}</Field>
        <Field label="Origin">{(id) => <Select id={id} value={v.origin} onChange={(x) => f.set('origin', x)} options={ASSET_ORIGINS} />}</Field>
        <Field label={v.origin === 'acquired' ? 'Date acquired' : 'Date created'} error={f.errors.start_date}>{(id) => <Input id={id} type="date" value={v.start_date} onChange={(x) => f.set('start_date', x)} />}</Field>

        <div className="form-section">Capital & value</div>
        {v.origin === 'acquired' ? (
          <Field label="Acquisition price" error={f.errors.acquisition_price} hint="Purchase price only. Record fees and later spend as capital transactions.">
            {(id) => <MoneyInput id={id} currency={currency} value={v.acquisition_price} onChange={(x) => f.set('acquisition_price', x)} />}
          </Field>
        ) : (
          <Field label="Acquisition price" hint="Not applicable for assets you built">{(id) => <Input id={id} value="—" onChange={() => {}} disabled />}</Field>
        )}
        <Field label="Current estimated value" error={f.errors.current_value} hint={asset ? 'Changing this records a new dated valuation' : 'Optional. Recorded as a dated valuation.'}>
          {(id) => <MoneyInput id={id} currency={currency} value={v.current_value} onChange={(x) => f.set('current_value', x)} />}
        </Field>
        <Field label="Time required (hours / week)" error={f.errors.weekly_hours}>{(id) => <Input id={id} inputMode="decimal" value={v.weekly_hours} onChange={(x) => f.set('weekly_hours', x)} />}</Field>

        <div className="form-section">Business</div>
        <Field label="Business model" span={3}>{(id) => <Input id={id} value={v.business_model} onChange={(x) => f.set('business_model', x)} placeholder="e.g. B2B analytics for Shopify merchants" />}</Field>
        <Field label="Revenue model" span={3}>{(id) => <Input id={id} value={v.revenue_model} onChange={(x) => f.set('revenue_model', x)} placeholder="e.g. Monthly subscriptions, display ads, one-off sales" />}</Field>
        <Field label="Short description" span={3}>{(id) => <Textarea id={id} rows={2} value={v.description} onChange={(x) => f.set('description', x)} />}</Field>
        <Field label="Strategic objectives" span={3}>{(id) => <Textarea id={id} value={v.objectives} onChange={(x) => f.set('objectives', x)} />}</Field>

        <div className="form-section">Risk & potential</div>
        <Field label="Risk level">{(id) => <Select id={id} value={v.risk_level} onChange={(x) => f.set('risk_level', x)} options={LEVELS} placeholder="Not assessed" />}</Field>
        <Field label="Growth potential">{(id) => <Select id={id} value={v.growth_potential} onChange={(x) => f.set('growth_potential', x)} options={LEVELS} placeholder="Not assessed" />}</Field>
        <div />
        <Field label="Key risks & operational issues" span={3}>{(id) => <Textarea id={id} rows={3} value={v.key_risks} onChange={(x) => f.set('key_risks', x)} />}</Field>
        <Field label="Notes" span={3}>{(id) => <Textarea id={id} rows={3} value={v.notes} onChange={(x) => f.set('notes', x)} />}</Field>
      </FormGrid>
    </FormModal>
  );
}
