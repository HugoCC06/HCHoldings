import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useRemove, useSave } from '../lib/api';
import { useCurrency, useMoney } from '../lib/format';
import { useForm, moneyFields } from '../lib/form';
import { formatDate, todayISO } from '../../shared/dates';
import { minorToInput } from '../../shared/money';
import type { Valuation } from '../../shared/types';
import { SimpleArea } from './charts';
import { Button, Empty, Field, FormGrid, FormModal, Input, MoneyInput, Panel } from './ui';

export function ValuationsPanel({ assetId, valuations }: { assetId: number; valuations: Valuation[] }) {
  const money = useMoney();
  const remove = useRemove('valuations');
  const [editing, setEditing] = useState<Valuation | 'new' | null>(null);
  const list = valuations.filter((v) => v.asset_id === assetId).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const chart = [...list].reverse().map((v) => ({ label: formatDate(v.date), value: v.value }));
  return (
    <Panel title="Valuation history" sub="Your dated estimates of what this asset is worth" actions={<Button size="sm" icon={<Plus size={14} />} onClick={() => setEditing('new')}>Valuation</Button>}>
      {list.length ? (
        <>
          {list.length > 1 && <SimpleArea data={chart} dataKey="value" name="Estimated value" format={(v) => money(v, { compact: true })} height={180} />}
          <table className="table compact mt-sm">
            <thead><tr><th>Date</th><th>Method / basis</th><th className="num">Value</th><th /></tr></thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.id}>
                  <td className="subtle">{formatDate(v.date)}</td>
                  <td>{v.method ?? <span className="muted">—</span>}</td>
                  <td className="num">{money(v.value)}</td>
                  <td className="actions">
                    <span className="row-actions">
                      <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEditing(v)} aria-label="Edit" />
                      <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => remove.mutate({ id: v.id })} aria-label="Delete" />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <Empty compact title="No valuations recorded">Estimated value stays blank until you record one — it is never inferred.</Empty>
      )}
      {editing && <ValuationForm assetId={assetId} valuation={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function ValuationForm({ assetId, valuation, onClose }: { assetId: number; valuation?: Valuation; onClose: () => void }) {
  const save = useSave('valuations');
  const currency = useCurrency();
  const f = useForm({ date: valuation?.date ?? todayISO(), value: minorToInput(valuation?.value), method: valuation?.method ?? '' });
  const submit = () => {
    const m = moneyFields(f.values, ['value'], ['value']);
    if (!m.ok) return f.setErrors(m.errors);
    save.mutateAsync({ id: valuation?.id, data: { asset_id: assetId, date: f.values.date, value: m.out.value, method: f.values.method } }).then(onClose, f.handleError);
  };
  return (
    <FormModal title={valuation ? 'Edit valuation' : 'Record valuation'} onClose={onClose} onSubmit={submit} saving={save.isPending} error={f.formError} width={500}>
      <FormGrid cols={2}>
        <Field label="Date" error={f.errors.date}>{(id) => <Input id={id} type="date" value={f.values.date} onChange={(v) => f.set('date', v)} />}</Field>
        <Field label="Estimated value" error={f.errors.value}>{(id) => <MoneyInput id={id} currency={currency} value={f.values.value} onChange={(v) => f.set('value', v)} autoFocus />}</Field>
        <Field label="Method / basis" span={2} hint="e.g. 3.2× annual profit, broker quote, last offer received">{(id) => <Input id={id} value={f.values.method} onChange={(v) => f.set('method', v)} />}</Field>
      </FormGrid>
    </FormModal>
  );
}
