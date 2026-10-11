import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DatabaseBackup, Download, FileJson, HardDriveDownload, Upload } from 'lucide-react';
import { api, downloadFile, invalidateAll, queryClient, useSnapshot } from '../lib/api';
import { useForm } from '../lib/form';
import { CURRENCIES } from '../../shared/domain';
import { formatBytes } from '../components/knowledge';
import { Button, ErrorBox, Field, FormGrid, Input, Loading, PageHeader, Panel, Select, useConfirm, useToast } from '../components/ui';

export function SettingsPage() {
  const { data: s, isLoading, error } = useSnapshot();
  if (isLoading) return <Loading />;
  if (error || !s) return <ErrorBox error={error} />;
  return (
    <>
      <PageHeader title="Settings & backups" subtitle="Your data lives in a single local database file. Back it up regularly." />
      <div className="grid grid-2">
        <GeneralSettings initial={s.settings} />
        <BackupPanel />
      </div>
    </>
  );
}

function GeneralSettings({ initial }: { initial: { company_name: string; currency: string; fiscal_year_start: number } }) {
  const toast = useToast();
  const f = useForm({ company_name: initial.company_name, currency: initial.currency, fiscal_year_start: String(initial.fiscal_year_start), saving: false });
  const save = async () => {
    f.set('saving', true);
    try {
      await api('/api/settings', { method: 'PUT', json: { company_name: f.values.company_name, currency: f.values.currency, fiscal_year_start: Number(f.values.fiscal_year_start) } });
      await invalidateAll();
      toast('Settings saved');
    } catch (e) {
      f.handleError(e);
    } finally {
      f.set('saving', false);
    }
  };
  return (
    <Panel title="General" actions={<Button size="sm" variant="primary" loading={f.values.saving} onClick={save}>Save</Button>}>
      {f.formError && <div className="alert alert-error">{f.formError}</div>}
      <FormGrid cols={1}>
        <Field label="Holding company name" error={f.errors.company_name}>{(id) => <Input id={id} value={f.values.company_name} onChange={(v) => f.set('company_name', v)} />}</Field>
        <Field label="Reporting currency" hint="All amounts are recorded and shown in this single currency. Changing it relabels figures; it does not convert them.">
          {(id) => <Select id={id} value={f.values.currency} onChange={(v) => f.set('currency', v)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />}
        </Field>
      </FormGrid>
    </Panel>
  );
}

function BackupPanel() {
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const backups = useQuery({ queryKey: ['backups'], queryFn: () => api<{ file: string; size: number; created: string }[]>('/api/backups') });

  const restore = async (file: File) => {
    const ok = await confirm({
      title: 'Restore from this backup?',
      body: <>All current data will be replaced by <b>{file.name}</b>. A safety backup of your current data is created first, so this can be undone.</>,
      danger: true,
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    setBusy('restore');
    try {
      await api('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      await queryClient.resetQueries();
      toast('Backup restored');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Backup & restore" sub="Backups include every record and uploaded document.">
      <div className="stack gap-md">
        <div className="row gap-sm wrap">
          <Button variant="primary" icon={<HardDriveDownload size={15} />} onClick={() => downloadFile('/api/backup')}>Download backup</Button>
          <Button icon={<DatabaseBackup size={15} />} loading={busy === 'create'} onClick={async () => {
            setBusy('create');
            try { await api('/api/backups', { method: 'POST' }); await backups.refetch(); toast('Backup created'); } catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(null); }
          }}>Create backup now</Button>
          <Button icon={<Upload size={15} />} loading={busy === 'restore'} onClick={() => fileRef.current?.click()}>Restore from file…</Button>
          <input ref={fileRef} type="file" accept=".sqlite,.db,application/octet-stream" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) restore(f); }} />
        </div>
        <div className="row gap-sm wrap">
          <Button size="sm" variant="ghost" icon={<FileJson size={14} />} onClick={() => downloadFile('/api/export.json')}>Export all data as JSON</Button>
          <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={() => downloadFile('/api/transactions/export.csv')}>Export transactions CSV</Button>
        </div>
        <div className="alert alert-info">
          An automatic backup is taken when the app starts and once a day (last 14 kept) in the <code>backups</code> folder next to the database. Copy downloaded backups somewhere off this machine — an external drive or your own cloud storage.
        </div>
        <div>
          <div className="stat-label" style={{ marginBottom: 8 }}>Backups on this machine</div>
          {backups.isLoading ? <Loading /> : backups.data?.length ? (
            <table className="table compact">
              <thead><tr><th>File</th><th className="num">Size</th><th>Created</th></tr></thead>
              <tbody>
                {backups.data.slice(0, 20).map((b) => (
                  <tr key={b.file}><td className="small">{b.file}</td><td className="num subtle">{formatBytes(b.size)}</td><td className="subtle small">{new Date(b.created).toLocaleString('en-GB')}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <span className="muted small">None yet.</span>}
        </div>
      </div>
    </Panel>
  );
}
