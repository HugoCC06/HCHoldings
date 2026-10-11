import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { api, downloadText, invalidateAll, useList, useRemove, useSave, useSnapshot } from '../lib/api';
import { cx, useCurrency, useMoney } from '../lib/format';
import { useForm, moneyFields } from '../lib/form';
import { OPEX_CATEGORIES, TXN_CATEGORIES } from '../../shared/domain';
import { addMonths, formatDate, formatMonth, monthOf, monthRange, todayISO, daysBetween } from '../../shared/dates';
import { lastCompleteMonth, margin, monthlyTotals, sumTotals, cashPosition, type MonthTotals } from '../../shared/finance';
import { formatPct, minorToInput } from '../../shared/money';
import { toCsv } from '../../shared/csv';
import type { CashAccount, CashBalance, ImportBatch } from '../../shared/types';
import { TransactionsTable } from '../components/TransactionsTable';
import { TransactionForm } from '../components/TransactionForm';
import { Badge, Button, Empty, ErrorBox, Field, FormGrid, FormModal, Input, Loading, MoneyInput, PageHeader, Panel, Select, Stat, Tabs, Textarea, useConfirm, useToast } from '../components/ui';
import { useQuery } from '@tanstack/react-query';

type Tab = 'transactions' | 'pnl' | 'cash' | 'imports';

export function FinancePage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'transactions';
  const creating = params.get('new') === '1';
  return (
    <>
      <PageHeader title="Finance" subtitle="Revenue, operating expenses, capital invested and cash — kept strictly separate." />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        tabs={[
          { key: 'transactions', label: 'Transactions' },
          { key: 'pnl', label: 'Profit & loss' },
          { key: 'cash', label: 'Cash balances' },
          { key: 'imports', label: 'Import history' },
        ]}
      />
      {tab === 'transactions' && <TransactionsTable />}
      {tab === 'pnl' && <ProfitAndLoss />}
      {tab === 'cash' && <CashTab />}
      {tab === 'imports' && <ImportsTab />}
      {creating && <TransactionForm onClose={() => setParams({})} />}
    </>
  );
}

// ------------------------------------------------------------------ Profit & loss
export function ProfitAndLoss({ assetId }: { assetId?: number }) {
  const { data: s, isLoading, error } = useSnapshot();
  const money = useMoney();
  const [scope, setScope] = useState(assetId ? String(assetId) : 'all');
  const [period, setPeriod] = useState<'12' | '24' | 'fy'>('12');
  const end = lastCompleteMonth(todayISO());
  const months = useMemo(() => {
    if (period === 'fy') return monthRange(`${end.slice(0, 4)}-01`, end);
    return monthRange(addMonths(end, -(Number(period) - 1)), end);
  }, [period, end]);
  const txns = useMemo(() => (s?.transactions ?? []).filter((t) => scope === 'all' || (scope === 'holding' ? t.asset_id === null : t.asset_id === Number(scope))), [s, scope]);
  const rows = useMemo(() => monthlyTotals(txns, months), [txns, months]);
  const total = useMemo(() => sumTotals(txns.filter((t) => months.includes(monthOf(t.date)))), [txns, months]);
  if (isLoading) return <Loading />;
  if (error || !s) return <ErrorBox error={error} />;

  const usedOpex = OPEX_CATEGORIES.filter((c) => total.opexByCategory[c]);
  type Line = { label: string; get: (r: Omit<MonthTotals, 'month'>) => number | null; strong?: boolean; pct?: boolean; indent?: boolean; muted?: boolean };
  const lines: Line[] = [
    { label: 'Revenue', get: (r) => r.revenue, strong: true },
    ...usedOpex.map((c) => ({ label: TXN_CATEGORIES[c].label, get: (r: Omit<MonthTotals, 'month'>) => r.opexByCategory[c] ?? 0, indent: true })),
    { label: 'Total operating expenses', get: (r) => r.opex },
    { label: 'Operating profit', get: (r) => r.profit, strong: true },
    { label: 'Operating margin', get: (r) => margin(r.revenue, r.profit), pct: true, muted: true },
    { label: 'Capital invested', get: (r) => r.capital, muted: true },
    { label: 'Owner contributions', get: (r) => r.ownerIn, muted: true },
    { label: 'Owner distributions', get: (r) => r.ownerOut, muted: true },
    { label: 'Net cash flow', get: (r) => r.netCashFlow, strong: true },
  ];
  const fmt = (l: Line, v: number | null) => (l.pct ? formatPct(v, 0) : money(v, { decimals: false }));
  const exportCsv = () =>
    downloadText(`profit-and-loss-${end}.csv`, toCsv(['Line', ...months, 'Total'], lines.map((l) => [l.label, ...rows.map((r) => (l.pct ? (l.get(r) === null ? '' : (l.get(r)! * 100).toFixed(1) + '%') : minorToInput(l.get(r) ?? 0))), l.pct ? (l.get(total) === null ? '' : (l.get(total)! * 100).toFixed(1) + '%') : minorToInput(l.get(total) ?? 0)])));

  return (
    <>
      <div className="filters">
        {!assetId && (
          <select className="input select" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">Whole portfolio</option>
            <option value="holding">Holding company only</option>
            {s.assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <Select value={period} onChange={(v) => setPeriod(v)} options={{ '12': 'Last 12 months', '24': 'Last 24 months', fy: 'Calendar year to date' }} />
        <div className="grow" />
        <Button size="sm" icon={<Download size={14} />} onClick={exportCsv}>Export CSV</Button>
      </div>
      <div className="kpis">
        <Stat label="Revenue" value={money(total.revenue, { decimals: false })} sub={`${months.length} months`} />
        <Stat label="Operating expenses" value={money(total.opex, { decimals: false })} />
        <Stat label="Operating profit" value={money(total.profit, { decimals: false })} tone={total.profit < 0 ? 'bad' : undefined} sub={formatPct(margin(total.revenue, total.profit)) + ' margin'} />
        <Stat label="Capital invested" value={money(total.capital, { decimals: false })} sub="Excludes purchase prices" />
        <Stat label="Net cash flow" value={money(total.netCashFlow, { decimals: false })} sub="After capital & owner flows" />
      </div>
      <Panel pad={false} title="Monthly statement" sub="Completed months only. Capital and owner flows are shown below operating profit and never change it.">
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th style={{ minWidth: 200, position: 'sticky', left: 0, zIndex: 1 }}>Line</th>
                {months.map((m) => <th key={m} className="num">{formatMonth(m)}</th>)}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.label}>
                  <td style={{ paddingLeft: l.indent ? 26 : undefined, fontWeight: l.strong ? 600 : undefined, position: 'sticky', left: 0, background: 'var(--surface)' }} className={cx(l.muted && 'subtle')}>{l.label}</td>
                  {rows.map((r) => {
                    const v = l.get(r);
                    return <td key={r.month} className={cx('num', l.strong && 'cell-main', v !== null && v < 0 && 'tone-bad', l.muted && 'subtle')}>{fmt(l, v)}</td>;
                  })}
                  <td className={cx('num', 'cell-main', (l.get(total) ?? 0) < 0 && 'tone-bad')}>{fmt(l, l.get(total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

// ------------------------------------------------------------------ Cash
function CashTab() {
  const { data: accounts = [], isLoading } = useList('cash-accounts');
  const { data: balances = [] } = useList('cash-balances');
  const money = useMoney();
  const confirm = useConfirm();
  const removeAccount = useRemove('cash-accounts');
  const removeBalance = useRemove('cash-balances');
  const [editAccount, setEditAccount] = useState<CashAccount | 'new' | null>(null);
  const [editBalance, setEditBalance] = useState<{ balance?: CashBalance; accountId?: number } | null>(null);
  const today = todayISO();
  const active = accounts.filter((a) => !a.archived);
  const pos = cashPosition(balances, active.map((a) => a.id));
  const latest = (id: number) => balances.filter((b) => b.account_id === id).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)[0];
  if (isLoading) return <Loading />;

  return (
    <>
      <div className="alert alert-info">
        Cash balances are point-in-time snapshots of what sits in your bank and payment accounts. They are not revenue or profit and are never added to them.
      </div>
      <div className="kpis">
        <Stat label="Total cash" value={pos ? money(pos.total, { decimals: false }) : '—'} sub={pos ? `Oldest balance ${formatDate(pos.oldestDate)}` : 'No balances recorded'} />
        <Stat label="Accounts" value={active.length} />
      </div>
      <div className="grid grid-2">
        <Panel title="Accounts" actions={<Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setEditAccount('new')}>Account</Button>} pad={false}>
          {accounts.length ? (
            <table className="table">
              <thead><tr><th>Account</th><th className="num">Latest balance</th><th>As of</th><th /></tr></thead>
              <tbody>
                {accounts.map((a) => {
                  const l = latest(a.id);
                  const stale = l && daysBetween(l.date, today) > 45;
                  return (
                    <tr key={a.id}>
                      <td>
                        <div className="cell-main">{a.name} {a.archived && <Badge>Archived</Badge>}</div>
                        <div className="cell-sub">{a.institution}</div>
                      </td>
                      <td className={cx('num', l && l.balance < 0 && 'tone-bad')}>{l ? money(l.balance) : '—'}</td>
                      <td className={cx('small', stale ? 'tone-warn' : 'subtle')}>{l ? formatDate(l.date) : 'Never'}</td>
                      <td className="actions">
                        <Button size="sm" onClick={() => setEditBalance({ accountId: a.id })}>Update balance</Button>
                        <span className="row-actions">
                          <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEditAccount(a)} aria-label="Edit" />
                          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label="Delete" onClick={async () => {
                            if (await confirm({ title: `Delete ${a.name}?`, body: 'Its balance history will also be deleted. Archive it instead to keep history.', danger: true, confirmLabel: 'Delete' })) removeAccount.mutate({ id: a.id });
                          }} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <Empty title="No cash accounts" action={<Button variant="primary" onClick={() => setEditAccount('new')}>Add an account</Button>}>Add business bank accounts, Stripe/PayPal balances and similar.</Empty>
          )}
        </Panel>
        <Panel title="Balance history" pad={false}>
          {balances.length ? (
            <div className="table-wrap" style={{ maxHeight: 460 }}>
              <table className="table compact">
                <thead><tr><th>Date</th><th>Account</th><th className="num">Balance</th><th /></tr></thead>
                <tbody>
                  {balances.map((b) => (
                    <tr key={b.id}>
                      <td className="subtle">{formatDate(b.date)}</td>
                      <td>{accounts.find((a) => a.id === b.account_id)?.name}{b.notes && <div className="cell-sub">{b.notes}</div>}</td>
                      <td className={cx('num', b.balance < 0 && 'tone-bad')}>{money(b.balance)}</td>
                      <td className="actions">
                        <span className="row-actions">
                          <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEditBalance({ balance: b })} aria-label="Edit" />
                          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => removeBalance.mutate({ id: b.id })} aria-label="Delete" />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty compact title="No balances recorded" />
          )}
        </Panel>
      </div>
      {editAccount && <AccountForm account={editAccount === 'new' ? undefined : editAccount} onClose={() => setEditAccount(null)} />}
      {editBalance && <BalanceForm {...editBalance} accounts={active} onClose={() => setEditBalance(null)} />}
    </>
  );
}

function AccountForm({ account, onClose }: { account?: CashAccount; onClose: () => void }) {
  const save = useSave('cash-accounts');
  const f = useForm({ name: account?.name ?? '', institution: account?.institution ?? '', notes: account?.notes ?? '', archived: account?.archived ?? false });
  return (
    <FormModal title={account ? 'Edit account' : 'New cash account'} onClose={onClose} saving={save.isPending} error={f.formError} width={480}
      onSubmit={() => save.mutateAsync({ id: account?.id, data: f.values }).then(onClose, f.handleError)}>
      <FormGrid cols={1}>
        <Field label="Name" error={f.errors.name}>{(id) => <Input id={id} value={f.values.name} onChange={(v) => f.set('name', v)} placeholder="e.g. Business current account" />}</Field>
        <Field label="Institution">{(id) => <Input id={id} value={f.values.institution} onChange={(v) => f.set('institution', v)} />}</Field>
        <Field label="Notes">{(id) => <Textarea id={id} rows={2} value={f.values.notes} onChange={(v) => f.set('notes', v)} />}</Field>
        {account && <label className="checkbox"><input type="checkbox" checked={f.values.archived} onChange={(e) => f.set('archived', e.target.checked)} /> Archived (excluded from total cash)</label>}
      </FormGrid>
    </FormModal>
  );
}

function BalanceForm({ balance, accountId, accounts, onClose }: { balance?: CashBalance; accountId?: number; accounts: CashAccount[]; onClose: () => void }) {
  const save = useSave('cash-balances');
  const currency = useCurrency();
  const f = useForm({ account_id: String(balance?.account_id ?? accountId ?? accounts[0]?.id ?? ''), date: balance?.date ?? todayISO(), balance: minorToInput(balance?.balance), notes: balance?.notes ?? '' });
  const submit = () => {
    const m = moneyFields(f.values, ['balance'], ['balance']);
    if (!m.ok) return f.setErrors(m.errors);
    save.mutateAsync({ id: balance?.id, data: { ...f.values, account_id: Number(f.values.account_id), balance: m.out.balance } }).then(onClose, f.handleError);
  };
  return (
    <FormModal title="Record balance" onClose={onClose} onSubmit={submit} saving={save.isPending} error={f.formError} width={480}>
      <FormGrid cols={2}>
        <Field label="Account" span={2}>{(id) => <Select id={id} value={f.values.account_id} onChange={(v) => f.set('account_id', v)} options={accounts.map((a) => ({ value: String(a.id), label: a.name }))} />}</Field>
        <Field label="Date" error={f.errors.date}>{(id) => <Input id={id} type="date" value={f.values.date} onChange={(v) => f.set('date', v)} />}</Field>
        <Field label="Balance" error={f.errors.balance} hint="Negative for overdrawn">{(id) => <MoneyInput id={id} currency={currency} value={f.values.balance} onChange={(v) => f.set('balance', v)} autoFocus />}</Field>
        <Field label="Notes" span={2}>{(id) => <Input id={id} value={f.values.notes} onChange={(v) => f.set('notes', v)} />}</Field>
      </FormGrid>
    </FormModal>
  );
}

// ------------------------------------------------------------------ Imports
function ImportsTab() {
  const { data = [], isLoading } = useQuery({ queryKey: ['import-batches'], queryFn: () => api<ImportBatch[]>('/api/import-batches') });
  const confirm = useConfirm();
  const toast = useToast();
  if (isLoading) return <Loading />;
  return (
    <Panel pad={false} title="Import batches" sub="Undo an import to remove every transaction it created.">
      {data.length ? (
        <table className="table">
          <thead><tr><th>File</th><th>Imported</th><th className="num">Rows imported</th><th className="num">Rows skipped</th><th /></tr></thead>
          <tbody>
            {data.map((b) => (
              <tr key={b.id}>
                <td className="cell-main">{b.filename}</td>
                <td className="subtle">{b.imported_at.replace('T', ' ').slice(0, 16)} UTC</td>
                <td className="num">{b.row_count}</td>
                <td className="num">{b.skipped_count}</td>
                <td className="actions">
                  <Button size="sm" variant="danger" icon={<Undo2 size={14} />} onClick={async () => {
                    if (!(await confirm({ title: 'Undo this import?', body: `All transactions created by “${b.filename}” will be deleted, including any edits made to them since.`, danger: true, confirmLabel: 'Undo import' }))) return;
                    const r = await api<{ removed: number }>(`/api/import-batches/${b.id}`, { method: 'DELETE' });
                    await invalidateAll();
                    toast(`Removed ${r.removed} transactions`);
                  }}>Undo</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty title="No imports yet" />
      )}
    </Panel>
  );
}
