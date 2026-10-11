import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { api, invalidateAll, useList, useRemove, useSave, useSnapshot } from '../lib/api';
import { formatNumber, useMoney } from '../lib/format';
import { useForm, moneyFields, numOrNull } from '../lib/form';
import { GOAL_METRICS, GOAL_STATUSES, type GoalMetric } from '../../shared/domain';
import { addMonths, formatDate, formatMonth, todayISO } from '../../shared/dates';
import { lastCompleteMonth } from '../../shared/finance';
import { goalActual, goalProgress, metricTrends } from '../../shared/insights';
import { minorToInput } from '../../shared/money';
import type { Goal, Metric, Review } from '../../shared/types';
import { AssetSelect } from './TransactionForm';
import { Badge, Button, Delta, Empty, Field, FormGrid, FormModal, Input, MoneyInput, Panel, Progress, Select, Textarea, useToast } from './ui';

const isMoney = (m: GoalMetric) => m === 'monthly_revenue' || m === 'monthly_profit';

export function GoalForm({ goal, assetId, onClose }: { goal?: Goal; assetId?: number; onClose: () => void }) {
  const save = useSave('goals');
  const { data: s } = useSnapshot();
  const f = useForm({
    asset_id: String(goal?.asset_id ?? assetId ?? ''), title: goal?.title ?? '', metric: (goal?.metric ?? 'monthly_revenue') as GoalMetric, metric_name: goal?.metric_name ?? '',
    target: goal ? (isMoney(goal.metric) ? minorToInput(goal.target_value) : String(goal.target_value)) : '',
    manual_actual: goal?.manual_actual?.toString() ?? '', target_date: goal?.target_date ?? '', status: goal?.status ?? 'active', notes: goal?.notes ?? '',
  });
  const v = f.values;
  const metricNames = [...new Set((s?.metrics ?? []).filter((m) => String(m.asset_id) === v.asset_id).map((m) => m.name))];
  const submit = () => {
    let target: number | null;
    if (isMoney(v.metric)) {
      const m = moneyFields(v, ['target'], ['target']);
      if (!m.ok) return f.setErrors({ target_value: m.errors.target });
      target = m.out.target;
    } else {
      target = numOrNull(v.target);
      if (target === null) return f.setErrors({ target_value: 'Enter a number' });
    }
    if (!v.asset_id) return f.setErrors({ asset_id: 'Choose an asset' });
    save.mutateAsync({ id: goal?.id, data: { asset_id: Number(v.asset_id), title: v.title, metric: v.metric, metric_name: v.metric === 'metric' ? v.metric_name : null, target_value: target, manual_actual: v.metric === 'custom' ? numOrNull(v.manual_actual) : null, target_date: v.target_date || null, status: v.status, notes: v.notes } }).then(onClose, f.handleError);
  };
  return (
    <FormModal title={goal ? 'Edit goal' : 'New goal'} onClose={onClose} onSubmit={submit} saving={save.isPending} error={f.formError}>
      <FormGrid cols={2}>
        <Field label="Asset" error={f.errors.asset_id}>{(id) => <AssetSelect id={id} value={v.asset_id} onChange={(x) => f.set('asset_id', x)} placeholder="Choose…" />}</Field>
        <Field label="Status">{(id) => <Select id={id} value={v.status} onChange={(x) => f.set('status', x)} options={GOAL_STATUSES} />}</Field>
        <Field label="Goal" error={f.errors.title} span={2}>{(id) => <Input id={id} value={v.title} onChange={(x) => f.set('title', x)} placeholder="e.g. Reach £5k monthly revenue" autoFocus />}</Field>
        <Field label="Measured by" span={2}>{(id) => <Select id={id} value={v.metric} onChange={(x) => f.set('metric', x)} options={GOAL_METRICS} />}</Field>
        {v.metric === 'metric' && (
          <Field label="Metric name" span={2} hint={metricNames.length ? `Recorded: ${metricNames.join(', ')}` : 'Record metric snapshots on the asset (e.g. Subscribers)'}>
            {(id) => <Input id={id} value={v.metric_name} onChange={(x) => f.set('metric_name', x)} list="metric-names" />}
          </Field>
        )}
        <datalist id="metric-names">{metricNames.map((n) => <option key={n} value={n} />)}</datalist>
        <Field label="Target" error={f.errors.target_value}>{(id) => isMoney(v.metric) ? <MoneyInput id={id} currency={s?.settings.currency} value={v.target} onChange={(x) => f.set('target', x)} /> : <Input id={id} inputMode="decimal" value={v.target} onChange={(x) => f.set('target', x)} />}</Field>
        <Field label="Target date">{(id) => <Input id={id} type="date" value={v.target_date} onChange={(x) => f.set('target_date', x)} />}</Field>
        {v.metric === 'custom' && <Field label="Current progress" hint="Updated manually">{(id) => <Input id={id} inputMode="decimal" value={v.manual_actual} onChange={(x) => f.set('manual_actual', x)} />}</Field>}
        <Field label="Notes" span={2}>{(id) => <Textarea id={id} rows={2} value={v.notes} onChange={(x) => f.set('notes', x)} />}</Field>
      </FormGrid>
    </FormModal>
  );
}

export function GoalsTable({ goals, showAsset = true, onEdit }: { goals: Goal[]; showAsset?: boolean; onEdit: (g: Goal) => void }) {
  const { data: s } = useSnapshot();
  const money = useMoney();
  const remove = useRemove('goals');
  if (!s) return null;
  if (!goals.length) return <Empty compact title="No goals set">Set revenue, profit or audience targets to track actual performance against them.</Empty>;
  const end = lastCompleteMonth(todayISO());
  const fmt = (g: Goal, v: number | null) => (v === null ? '—' : isMoney(g.metric) ? money(v, { decimals: false }) : formatNumber(v, 1));
  return (
    <div className="table-wrap">
      <table className="table compact">
        <thead><tr><th>Goal</th>{showAsset && <th>Asset</th>}<th className="num">Actual</th><th className="num">Target</th><th style={{ minWidth: 140 }}>Progress</th><th>Due</th><th>Status</th><th /></tr></thead>
        <tbody>
          {goals.map((g) => {
            const actual = goalActual(g, s.transactions, s.metrics, end);
            const p = goalProgress(actual, g.target_value);
            return (
              <tr key={g.id}>
                <td><div className="cell-main">{g.title}</div><div className="cell-sub">{GOAL_METRICS[g.metric]}{g.metric_name ? ` · ${g.metric_name}` : ''}{isMoney(g.metric) ? ` · ${formatMonth(end)}` : ''}</div></td>
                {showAsset && <td className="subtle">{s.assets.find((a) => a.id === g.asset_id)?.name}</td>}
                <td className="num">{fmt(g, actual)}</td>
                <td className="num">{fmt(g, g.target_value)}</td>
                <td><div className="row gap-sm"><div className="grow"><Progress value={p} /></div><span className="small muted">{p === null ? '—' : `${Math.round(p * 100)}%`}</span></div></td>
                <td className="small subtle">{formatDate(g.target_date)}</td>
                <td><Badge tone={g.status === 'achieved' ? 'good' : g.status === 'missed' ? 'bad' : g.status === 'active' ? 'info' : 'neutral'}>{GOAL_STATUSES[g.status]}</Badge></td>
                <td className="actions"><span className="row-actions">
                  <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => onEdit(g)} aria-label="Edit" />
                  <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => remove.mutate({ id: g.id })} aria-label="Delete" />
                </span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MetricForm({ assetId, metric, onClose }: { assetId: number; metric?: Metric; onClose: () => void }) {
  const save = useSave('metrics');
  const { data: s } = useSnapshot();
  const names = [...new Set((s?.metrics ?? []).filter((m) => m.asset_id === assetId).map((m) => m.name))];
  const f = useForm({ name: metric?.name ?? names[0] ?? '', date: metric?.date ?? todayISO(), value: metric?.value?.toString() ?? '', notes: metric?.notes ?? '' });
  const submit = () => {
    const value = numOrNull(f.values.value);
    if (value === null) return f.setErrors({ value: 'Enter a number' });
    save.mutateAsync({ id: metric?.id, data: { ...f.values, asset_id: assetId, value } }).then(onClose, f.handleError);
  };
  return (
    <FormModal title="Record metric" onClose={onClose} onSubmit={submit} saving={save.isPending} error={f.formError} width={500}>
      <FormGrid cols={2}>
        <Field label="Metric" error={f.errors.name} hint="e.g. Subscribers, Monthly visitors, Paying customers, Downloads">{(id) => <Input id={id} value={f.values.name} onChange={(x) => f.set('name', x)} list="metric-list" />}</Field>
        <datalist id="metric-list">{names.map((n) => <option key={n} value={n} />)}</datalist>
        <Field label="Date" error={f.errors.date}>{(id) => <Input id={id} type="date" value={f.values.date} onChange={(x) => f.set('date', x)} />}</Field>
        <Field label="Value" error={f.errors.value}>{(id) => <Input id={id} inputMode="decimal" value={f.values.value} onChange={(x) => f.set('value', x)} autoFocus />}</Field>
        <Field label="Notes">{(id) => <Input id={id} value={f.values.notes} onChange={(x) => f.set('notes', x)} />}</Field>
      </FormGrid>
    </FormModal>
  );
}

export function MetricsPanel({ assetId }: { assetId: number }) {
  const { data: s } = useSnapshot();
  const remove = useRemove('metrics');
  const [editing, setEditing] = useState<Metric | 'new' | null>(null);
  const metrics = (s?.metrics ?? []).filter((m) => m.asset_id === assetId);
  const trends = metricTrends(metrics, assetId);
  return (
    <Panel title="Audience & customer metrics" sub="Dated snapshots you record" actions={<Button size="sm" icon={<Plus size={14} />} onClick={() => setEditing('new')}>Record</Button>}>
      {trends.length ? (
        <>
          <div className="kpis" style={{ marginBottom: 12 }}>
            {trends.map((t) => (
              <div className="stat" key={t.name}>
                <div className="stat-label">{t.name}</div>
                <div className="stat-value">{formatNumber(t.latest, 1)}</div>
                <div className="stat-sub"><Delta value={t.change} /> since previous · {formatDate(t.date)}</div>
              </div>
            ))}
          </div>
          <table className="table compact">
            <thead><tr><th>Date</th><th>Metric</th><th className="num">Value</th><th /></tr></thead>
            <tbody>
              {[...metrics].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).map((m) => (
                <tr key={m.id}>
                  <td className="subtle">{formatDate(m.date)}</td><td>{m.name}</td><td className="num">{formatNumber(m.value, 2)}</td>
                  <td className="actions"><span className="row-actions">
                    <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEditing(m)} aria-label="Edit" />
                    <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => remove.mutate({ id: m.id })} aria-label="Delete" />
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : <Empty compact title="No metrics recorded">Track subscribers, visitors, customers or downloads to see audience growth.</Empty>}
      {editing && <MetricForm assetId={assetId} metric={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

const REVIEW_FIELDS: { key: keyof Review & string; label: string; placeholder: string }[] = [
  { key: 'improved', label: 'What improved', placeholder: 'Wins, metrics that moved the right way…' },
  { key: 'underperformed', label: 'What performed poorly', placeholder: 'Misses, declines, disappointments…' },
  { key: 'learned', label: 'What I learned', placeholder: 'Insights about customers, channels, myself…' },
  { key: 'fix', label: 'What needs fixing', placeholder: 'Broken processes, technical debt, risks…' },
  { key: 'stop', label: 'What I should stop doing', placeholder: 'Low-leverage work to drop…' },
  { key: 'priorities', label: 'Priorities for next month', placeholder: 'The few things that matter most…' },
];

/** Monthly review editor for the portfolio (assetId undefined) or a single asset. */
export function ReviewEditor({ assetId, month: initialMonth }: { assetId?: number; month?: string }) {
  const toast = useToast();
  const [month, setMonth] = useState(initialMonth ?? lastCompleteMonth(todayISO()));
  const { data: reviews = [] } = useList('reviews', { asset_id: assetId ?? null });
  const existing = reviews.find((r) => r.month === month);
  const blank = useMemo(() => Object.fromEntries(REVIEW_FIELDS.map((f) => [f.key, ''])) as Record<string, string>, []);
  const [values, setValues] = useState<Record<string, string>>(blank);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setValues(existing ? Object.fromEntries(REVIEW_FIELDS.map((f) => [f.key, (existing[f.key] as string | null) ?? ''])) : blank);
  }, [existing, blank]);
  const dirty = REVIEW_FIELDS.some((f) => (values[f.key] ?? '') !== ((existing?.[f.key] as string | null) ?? ''));
  const save = async () => {
    setSaving(true);
    try {
      const data = { month, asset_id: assetId ?? null, ...values };
      await api(existing ? `/api/reviews/${existing.id}` : '/api/reviews', { method: existing ? 'PUT' : 'POST', json: data });
      await invalidateAll();
      toast('Review saved');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setSaving(false);
    }
  };
  const months = Array.from({ length: 13 }, (_, i) => addMonths(todayISO().slice(0, 7), -i));
  return (
    <Panel
      title={`Monthly review — ${formatMonth(month, true)}`}
      sub={existing ? `Last saved ${existing.updated_at.slice(0, 16).replace('T', ' ')} UTC` : 'Not yet written'}
      actions={
        <>
          <Select value={month} onChange={setMonth} options={months.map((m) => ({ value: m, label: formatMonth(m, true) + (reviews.some((r) => r.month === m) ? ' ✓' : '') }))} />
          <Button size="sm" variant="primary" icon={<Save size={14} />} disabled={!dirty} loading={saving} onClick={save}>Save review</Button>
        </>
      }
    >
      <div className="form-grid cols-2">
        {REVIEW_FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>{(id) => <Textarea id={id} rows={4} value={values[f.key]} onChange={(x) => setValues((v) => ({ ...v, [f.key]: x }))} placeholder={f.placeholder} />}</Field>
        ))}
      </div>
    </Panel>
  );
}
