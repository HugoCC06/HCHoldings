import { useState } from 'react';
import { Download, FileUp } from 'lucide-react';
import { api, downloadText, invalidateAll, useSnapshot } from '../lib/api';
import { cx, useMoney } from '../lib/format';
import { TXN_CATEGORIES } from '../../shared/domain';
import { formatDate } from '../../shared/dates';
import { TXN_CSV_HEADER, toCsv, type ImportRow } from '../../shared/csv';
import { Badge, Button, Modal, useToast } from './ui';

export function ImportModal({ onClose }: { onClose: () => void }) {
  const { data: snap } = useSnapshot();
  const money = useMoney();
  const toast = useToast();
  const [csv, setCsv] = useState<string | null>(null);
  const [filename, setFilename] = useState('');
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [include, setInclude] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = async (file: File) => {
    setError(null);
    setRows(null);
    if (file.size > 9_000_000) return setError('File is too large (max 9 MB).');
    const text = await file.text();
    setCsv(text);
    setFilename(file.name);
    try {
      const res = await api<{ rows: ImportRow[]; headerErrors: string[] }>('/api/transactions/import/preview', { method: 'POST', json: { csv: text, filename: file.name } });
      if (res.headerErrors.length) setError(res.headerErrors.join(' '));
      else setRows(res.rows);
      setInclude(new Set());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const template = () => {
    const example = snap?.assets[0]?.name ?? 'My Asset';
    downloadText('transactions-template.csv', toCsv(TXN_CSV_HEADER, [
      ['2026-01-31', example, 'revenue', '1250.00', 'Stripe payout', 'Stripe', ''],
      ['2026-01-15', example, 'hosting', '45.00', 'Server', 'Hetzner', ''],
      ['2026-01-10', 'Holding company', 'software', '12.00', 'Accounting software', 'Vendor', ''],
    ]));
  };

  const ok = rows?.filter((r) => !r.errors.length && !r.duplicate) ?? [];
  const dups = rows?.filter((r) => !r.errors.length && r.duplicate) ?? [];
  const bad = rows?.filter((r) => r.errors.length) ?? [];
  const toImport = ok.length + dups.filter((r) => include.has(r.line)).length;

  const commit = async () => {
    if (!csv) return;
    setBusy(true);
    try {
      const res = await api<{ imported: number; skipped: number }>('/api/transactions/import/commit', { method: 'POST', json: { csv, filename, includeDuplicates: [...include] } });
      await invalidateAll();
      toast(`Imported ${res.imported} transaction${res.imported === 1 ? '' : 's'}${res.skipped ? `, skipped ${res.skipped}` : ''}. You can undo this batch under Finance → Imports.`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import transactions from CSV"
      onClose={onClose}
      width={980}
      footer={
        <>
          <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={template}>Download template</Button>
          <div className="row gap-sm">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!rows || toImport === 0} loading={busy} onClick={commit}>Import {toImport || ''} row{toImport === 1 ? '' : 's'}</Button>
          </div>
        </>
      }
    >
      <div className="stack gap-md">
        <div className="alert alert-info">
          <div>
            Columns: <b>date</b>, <b>category</b>, <b>amount</b> (required) and optionally <b>asset</b>, <b>description</b>, <b>counterparty</b>, <b>notes</b>. Dates as YYYY-MM-DD or DD/MM/YYYY.
            Asset must match an asset name exactly (leave blank for the holding company). Categories: {Object.keys(TXN_CATEGORIES).join(', ')}. Rows already in your records are detected and skipped unless you tick them.
          </div>
        </div>
        <label className="btn btn-secondary" style={{ alignSelf: 'flex-start' }}>
          <FileUp size={15} /> {filename || 'Choose CSV file'}
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        {rows && (
          <>
            <div className="row gap-sm wrap">
              <Badge tone="good">{ok.length} ready</Badge>
              <Badge tone="warn">{dups.length} possible duplicate{dups.length === 1 ? '' : 's'}</Badge>
              <Badge tone="bad">{bad.length} with errors (will be skipped)</Badge>
            </div>
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table className="table compact">
                <thead>
                  <tr><th>Line</th><th>Status</th><th>Date</th><th>Asset</th><th>Category</th><th className="num">Amount</th><th>Description</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.line} className={cx(r.errors.length > 0 && 'muted')}>
                      <td className="muted">{r.line}</td>
                      <td>
                        {r.errors.length ? (
                          <span className="tone-bad small">{r.errors.join('; ')}</span>
                        ) : r.duplicate ? (
                          <label className="checkbox small">
                            <input type="checkbox" checked={include.has(r.line)} onChange={(e) => setInclude((s) => { const n = new Set(s); if (e.target.checked) n.add(r.line); else n.delete(r.line); return n; })} />
                            <span className="tone-warn">{r.duplicate === 'existing' ? 'Already recorded' : 'Repeated in file'} — import anyway</span>
                          </label>
                        ) : (
                          <Badge tone="good">OK</Badge>
                        )}
                      </td>
                      <td>{r.date ? formatDate(r.date) : '—'}</td>
                      <td>{r.assetName || 'Holding company'}</td>
                      <td>{r.category ? TXN_CATEGORIES[r.category].label : '—'}</td>
                      <td className="num">{r.amount !== null ? money(r.amount) : '—'}</td>
                      <td className="ellipsis" style={{ maxWidth: 240 }}>{r.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
