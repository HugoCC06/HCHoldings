import { useMemo, useState } from 'react';
import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { api, downloadText, invalidateAll, useList, useSnapshot } from '../lib/api';
import { cx, useMoney } from '../lib/format';
import { TXN_CATEGORIES, type TxnCategory } from '../../shared/domain';
import { formatDate, todayISO } from '../../shared/dates';
import { sumTotals } from '../../shared/finance';
import { TXN_CSV_HEADER, toCsv } from '../../shared/csv';
import { minorToInput } from '../../shared/money';
import type { Transaction } from '../../shared/types';
import { AssetSelect, CategorySelect, TransactionForm } from './TransactionForm';
import { ImportModal } from './ImportModal';
import { Badge, Button, Empty, Input, Loading, Panel, Select, useConfirm, useToast } from './ui';

const PRESETS = { all: 'All time', mtd: 'This month', last: 'Last month', '3m': 'Last 3 months', ytd: 'Year to date', '12m': 'Last 12 months', custom: 'Custom range' } as const;
type Preset = keyof typeof PRESETS;

function presetRange(p: Preset): [string, string] {
  const t = todayISO();
  const y = Number(t.slice(0, 4));
  const m = Number(t.slice(5, 7));
  const ym = (yy: number, mm: number) => { const d = new Date(Date.UTC(yy, mm - 1, 1)); return d.toISOString().slice(0, 7); };
  const end = (s: string) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7), 0)).toISOString().slice(0, 10);
  switch (p) {
    case 'mtd': return [`${t.slice(0, 7)}-01`, t];
    case 'last': { const s = ym(y, m - 1); return [`${s}-01`, end(s)]; }
    case '3m': return [`${ym(y, m - 2)}-01`, t];
    case 'ytd': return [`${y}-01-01`, t];
    case '12m': return [`${ym(y, m - 11)}-01`, t];
    default: return ['', ''];
  }
}

export function TransactionsTable({ assetId, title }: { assetId?: number; title?: string }) {
  const { data: snap } = useSnapshot();
  const { data: txns, isLoading } = useList('transactions', assetId ? { asset_id: assetId } : undefined);
  const money = useMoney();
  const confirm = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [asset, setAsset] = useState(assetId ? String(assetId) : 'any');
  const [category, setCategory] = useState('');
  const [preset, setPreset] = useState<Preset>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(200);

  const assetName = (id: number | null) => (id ? snap?.assets.find((a) => a.id === id)?.name : null) ?? 'Holding company';

  const filtered = useMemo(() => {
    const [pf, pt] = preset === 'custom' ? [from, to] : presetRange(preset);
    const cats = category.startsWith('class:') ? Object.entries(TXN_CATEGORIES).filter(([, m]) => m.class === category.slice(6)).map(([k]) => k) : category ? [category] : null;
    const needle = q.trim().toLowerCase();
    return (txns ?? []).filter((t) =>
      (asset === 'any' || (asset === '' ? t.asset_id === null : t.asset_id === Number(asset))) &&
      (!cats || cats.includes(t.category)) &&
      (!pf || t.date >= pf) && (!pt || t.date <= pt) &&
      (!needle || `${t.description ?? ''} ${t.counterparty ?? ''} ${t.notes ?? ''}`.toLowerCase().includes(needle)),
    );
  }, [txns, asset, category, preset, from, to, q]);
  const totals = useMemo(() => sumTotals(filtered), [filtered]);

  const exportCsv = () => {
    const csv = toCsv(TXN_CSV_HEADER, filtered.map((t) => [t.date, assetName(t.asset_id), t.category, minorToInput(t.amount), t.description, t.counterparty, t.notes]));
    downloadText(`transactions-${todayISO()}.csv`, csv);
  };
  const remove = async (ids: number[]) => {
    if (!(await confirm({ title: `Delete ${ids.length} transaction${ids.length > 1 ? 's' : ''}?`, body: 'This permanently removes the records and updates every calculation. A daily automatic backup is kept in Settings.', danger: true, confirmLabel: 'Delete' }))) return;
    try {
      await api('/api/transactions/bulk-delete', { method: 'POST', json: { ids } });
      setSelected(new Set());
      await invalidateAll();
      toast(`Deleted ${ids.length} transaction${ids.length > 1 ? 's' : ''}`);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <div className="filters">
        <Input className="search-input" placeholder="Search description, counterparty, notes…" value={q} onChange={setQ} />
        {!assetId && (
          <select className="input select" value={asset} onChange={(e) => setAsset(e.target.value)} aria-label="Asset filter">
            <option value="any">All assets</option>
            <option value="">Holding company only</option>
            {snap?.assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <select className="input select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category filter">
          <option value="">All categories</option>
          <option value="class:revenue">All revenue</option>
          <option value="class:opex">All operating expenses</option>
          <option value="class:capital">All capital invested</option>
          <option value="class:owner">All owner flows</option>
          {Object.entries(TXN_CATEGORIES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
        <Select value={preset} onChange={(v) => setPreset(v as Preset)} options={PRESETS} aria-label="Date range" />
        {preset === 'custom' && (
          <>
            <Input type="date" value={from} onChange={setFrom} aria-label="From" />
            <Input type="date" value={to} onChange={setTo} aria-label="To" />
          </>
        )}
        <div className="grow" />
        {selected.size > 0 && <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => remove([...selected])}>Delete {selected.size}</Button>}
        <Button size="sm" icon={<Download size={14} />} onClick={exportCsv} disabled={!filtered.length}>Export CSV</Button>
        {!assetId && <Button size="sm" icon={<Upload size={14} />} onClick={() => setImporting(true)}>Import CSV</Button>}
        <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setEditing('new')}>Record</Button>
      </div>

      <Panel pad={false} title={title} sub={`${filtered.length} transaction${filtered.length === 1 ? '' : 's'} · revenue ${money(totals.revenue)} · operating expenses ${money(totals.opex)} · operating profit ${money(totals.profit)}${totals.capital ? ` · capital ${money(totals.capital)}` : ''}`}>
        {isLoading ? (
          <Loading />
        ) : filtered.length ? (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input type="checkbox" aria-label="Select all" checked={selected.size > 0 && filtered.slice(0, limit).every((t) => selected.has(t.id))} onChange={(e) => setSelected(e.target.checked ? new Set(filtered.slice(0, limit).map((t) => t.id)) : new Set())} />
                  </th>
                  <th>Date</th><th>Description</th>{!assetId && <th>Asset</th>}<th>Category</th><th className="num">Amount</th><th />
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, limit).map((t) => {
                  const cls = TXN_CATEGORIES[t.category as TxnCategory].class;
                  const signed = cls === 'revenue' || t.category === 'owner_contribution' ? 1 : -1;
                  return (
                    <tr key={t.id} onDoubleClick={() => setEditing(t)}>
                      <td><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} aria-label="Select" /></td>
                      <td className="subtle" style={{ whiteSpace: 'nowrap' }}>{formatDate(t.date)}</td>
                      <td>
                        <div className="ellipsis" style={{ maxWidth: 360 }}>{t.description ?? <span className="muted">—</span>}</div>
                        {(t.counterparty || t.source === 'import') && (
                          <div className="cell-sub">{t.counterparty}{t.counterparty && t.source === 'import' ? ' · ' : ''}{t.source === 'import' && 'Imported'}</div>
                        )}
                      </td>
                      {!assetId && <td className="subtle">{assetName(t.asset_id)}</td>}
                      <td><Badge tone={cls === 'revenue' ? 'good' : cls === 'capital' ? 'info' : cls === 'owner' ? 'accent' : 'neutral'}>{TXN_CATEGORIES[t.category as TxnCategory].label}</Badge></td>
                      <td className={cx('num', signed > 0 ? 'tone-good' : undefined)}>{signed > 0 ? '+' : '−'}{money(t.amount)}</td>
                      <td className="actions">
                        <span className="row-actions">
                          <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEditing(t)} aria-label="Edit" />
                          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => remove([t.id])} aria-label="Delete" />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > limit && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + 500)}>Show more ({filtered.length - limit} remaining)</Button>
              </div>
            )}
          </div>
        ) : (
          <Empty title={txns?.length ? 'No transactions match these filters' : 'No transactions yet'} action={<Button variant="primary" onClick={() => setEditing('new')}>Record a transaction</Button>}>
            {!txns?.length && 'Record revenue, expenses and investments manually or import them from a CSV file.'}
          </Empty>
        )}
      </Panel>

      {editing && <TransactionForm txn={editing === 'new' ? undefined : editing} defaults={assetId ? { asset_id: assetId } : undefined} onClose={() => setEditing(null)} />}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </>
  );
}

export { CategorySelect, AssetSelect };
