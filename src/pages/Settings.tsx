import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DatabaseBackup, Download, FileJson, HardDriveDownload, Upload } from 'lucide-react';
import { api, downloadFile, invalidateAll, queryClient, useSnapshot } from '../lib/api';
import { useForm } from '../lib/form';
import { CURRENCIES } from '../../shared/domain';
import { Button, ErrorBox, Field, FormGrid, Input, Loading, PageHeader, Panel, Select, useConfirm, useToast } from '../components/ui';

export function SettingsPage() {
  const { data: s, isLoading, error } = useSnapshot();
  if (isLoading) return <Loading />;
  if (error || !s) return <ErrorBox error={error} />;
  return (
    <>
      <PageHeader title="Settings & backups" subtitle="Everything is stored privately in this browser. Download backups regularly." />
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
  const points = useQuery({ queryKey: ['backups'], queryFn: () => api<{ key: string; created: string; reason: string }[]>('/api/backups') });
  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      await queryClient.resetQueries();
      toast(done);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  const restore = async (file: File) => {
    const ok = await confirm({
      title: 'Restore from this backup?',
      body: <>All current data will be replaced by <b>{file.name}</b>. A restore point of your current data is saved first, so this can be undone below.</>,
      danger: true,
      confirmLabel: 'Restore',
    });
    if (ok) run('restore', () => api('/api/restore', { method: 'POST', body: file }), 'Backup restored');
  };

  return (
    <Panel title="Backup & restore" sub="Your data is stored only in this browser on this computer.">
      <div className="stack gap-md">
        <div className="alert alert-warn">
          Nothing is uploaded anywhere. That keeps it private, but it also means clearing Chrome’s site data, or using another browser or computer, starts empty.
          <b> Download a backup regularly</b> and keep it somewhere safe. To move to another computer, restore that file there.
        </div>
        <div className="row gap-sm wrap">
          <Button variant="primary" icon={<HardDriveDownload size={15} />} loading={busy === 'download'} onClick={() => run('download', () => downloadFile('/api/backup'), 'Backup downloaded')}>Download backup</Button>
          <Button icon={<Upload size={15} />} loading={busy === 'restore'} onClick={() => fileRef.current?.click()}>Restore from backup file…</Button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) restore(f); }} />
        </div>
        <div className="row gap-sm wrap">
          <Button size="sm" variant="ghost" icon={<FileJson size={14} />} onClick={() => downloadFile('/api/export.json').catch((e) => toast((e as Error).message, 'bad'))}>Export all data as JSON</Button>
          <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={() => downloadFile('/api/transactions/export.csv').catch((e) => toast((e as Error).message, 'bad'))}>Export transactions CSV</Button>
        </div>
        <div>
          <div className="row between" style={{ marginBottom: 8 }}>
            <div className="stat-label">Restore points in this browser</div>
            <Button size="sm" icon={<DatabaseBackup size={14} />} loading={busy === 'point'} onClick={() => run('point', () => api('/api/backups', { method: 'POST' }), 'Restore point saved')}>Save restore point</Button>
          </div>
          <p className="cell-sub" style={{ marginBottom: 8 }}>One is saved automatically each day you open the app (last 14 kept). They protect against mistakes, not against clearing browser data.</p>
          {points.isLoading ? <Loading /> : points.data?.length ? (
            <table className="table compact">
              <thead><tr><th>Saved</th><th>Reason</th><th /></tr></thead>
              <tbody>
                {points.data.map((b) => (
                  <tr key={b.key}>
                    <td className="small">{new Date(b.created).toLocaleString('en-GB')}</td>
                    <td className="subtle small">{b.reason}</td>
                    <td className="actions">
                      <Button size="sm" loading={busy === b.key} onClick={async () => {
                        if (await confirm({ title: 'Go back to this restore point?', body: 'Current data is replaced by this restore point. A new restore point of the current data is saved first. Documents uploaded after it may be missing.', danger: true, confirmLabel: 'Restore' }))
                          run(b.key, () => api(`/api/backups/${encodeURIComponent(b.key)}/restore`, { method: 'POST' }), 'Restored');
                      }}>Restore</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <span className="muted small">None yet.</span>}
        </div>
      </div>
    </Panel>
  );
}
