import { useSave, useSnapshot } from '../lib/api';
import { useForm, moneyFields, idOrNull } from '../lib/form';
import { useCurrency } from '../lib/format';
import { TXN_CATEGORIES, type TxnCategory } from '../../shared/domain';
import { minorToInput } from '../../shared/money';
import { todayISO } from '../../shared/dates';
import type { Transaction } from '../../shared/types';
import { Field, FormGrid, FormModal, Input, MoneyInput, Select, Textarea, useToast } from './ui';

export const CATEGORY_GROUPS: { label: string; cls: string }[] = [
  { label: 'Revenue', cls: 'revenue' },
  { label: 'Operating expenses', cls: 'opex' },
  { label: 'Capital invested', cls: 'capital' },
  { label: 'Owner flows', cls: 'owner' },
];

export function CategorySelect({ value, onChange, id, placeholder }: { value: string; onChange: (v: string) => void; id?: string; placeholder?: string }) {
  return (
    <select id={id} className="input select" value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {CATEGORY_GROUPS.map((g) => (
        <optgroup key={g.cls} label={g.label}>
          {(Object.entries(TXN_CATEGORIES) as [TxnCategory, { label: string; class: string }][])
            .filter(([, m]) => m.class === g.cls)
            .map(([k, m]) => (
              <option key={k} value={k}>{m.label}</option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

export function AssetSelect({ value, onChange, id, includeHolding = true, placeholder }: { value: string; onChange: (v: string) => void; id?: string; includeHolding?: boolean; placeholder?: string }) {
  const { data } = useSnapshot();
  const assets = data?.assets ?? [];
  return (
    <Select
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder ?? (includeHolding ? 'Holding company (no asset)' : 'None')}
      options={assets.filter((a) => !a.archived || String(a.id) === value).map((a) => ({ value: String(a.id), label: a.name + (a.archived ? ' (archived)' : '') }))}
    />
  );
}

const CLASS_HINT: Record<string, string> = {
  revenue: 'Operating income. Counts towards revenue and profit.',
  opex: 'Operating expense. Reduces operating profit.',
  capital: 'Capital deployed into an asset. Adds to invested capital; never affects operating profit.',
  owner: 'Money between you and the holding company. Affects cash only — not profit or invested capital.',
};

export function TransactionForm({ txn, defaults, onClose }: { txn?: Transaction; defaults?: Partial<{ asset_id: number; category: TxnCategory }>; onClose: () => void }) {
  const currency = useCurrency();
  const save = useSave('transactions');
  const toast = useToast();
  const f = useForm({
    date: txn?.date ?? todayISO(),
    asset_id: String(txn?.asset_id ?? defaults?.asset_id ?? ''),
    category: (txn?.category ?? defaults?.category ?? 'revenue') as string,
    amount: minorToInput(txn?.amount),
    description: txn?.description ?? '',
    counterparty: txn?.counterparty ?? '',
    notes: txn?.notes ?? '',
  });
  const v = f.values;
  const cls = TXN_CATEGORIES[v.category as TxnCategory]?.class;

  const submit = async (again = false) => {
    const m = moneyFields(v, ['amount'], ['amount']);
    if (m.ok && (m.out.amount ?? 0) <= 0) m.errors.amount = 'Enter a positive amount — the category decides whether it is income or cost';
    if (Object.keys(m.errors).length) return f.setErrors(m.errors);
    try {
      await save.mutateAsync({ id: txn?.id, data: { ...v, asset_id: idOrNull(v.asset_id), amount: m.out.amount } });
      toast(txn ? 'Transaction updated' : 'Transaction recorded');
      if (again) f.setValues((x) => ({ ...x, amount: '', description: '', counterparty: '', notes: '' }));
      else onClose();
    } catch (e) {
      f.handleError(e);
    }
  };

  return (
    <FormModal
      title={txn ? 'Edit transaction' : 'Record transaction'}
      onClose={onClose}
      onSubmit={() => submit(false)}
      saving={save.isPending}
      error={f.formError}
      extraActions={!txn && <button type="button" className="btn btn-ghost btn-sm" onClick={() => submit(true)}>Save & add another</button>}
    >
      <FormGrid cols={2}>
        <Field label="Date" error={f.errors.date}>{(id) => <Input id={id} type="date" value={v.date} onChange={(x) => f.set('date', x)} />}</Field>
        <Field label="Amount" error={f.errors.amount}>{(id) => <MoneyInput id={id} currency={currency} value={v.amount} onChange={(x) => f.set('amount', x)} autoFocus />}</Field>
        <Field label="Category" error={f.errors.category} hint={cls && CLASS_HINT[cls]}>{(id) => <CategorySelect id={id} value={v.category} onChange={(x) => f.set('category', x)} />}</Field>
        <Field label="Asset" error={f.errors.asset_id}>{(id) => <AssetSelect id={id} value={v.asset_id} onChange={(x) => f.set('asset_id', x)} />}</Field>
        <Field label="Description" error={f.errors.description}>{(id) => <Input id={id} value={v.description} onChange={(x) => f.set('description', x)} placeholder="e.g. Stripe payout, AWS invoice" />}</Field>
        <Field label="Counterparty" error={f.errors.counterparty}>{(id) => <Input id={id} value={v.counterparty} onChange={(x) => f.set('counterparty', x)} placeholder="Customer, vendor…" />}</Field>
        <Field label="Notes" span={2}>{(id) => <Textarea id={id} rows={2} value={v.notes} onChange={(x) => f.set('notes', x)} />}</Field>
      </FormGrid>
    </FormModal>
  );
}
