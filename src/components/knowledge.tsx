import { useRef, useState, type ReactNode } from 'react';
import { Download, ExternalLink, FileText, Paperclip, Pencil, Pin, Plus, Trash2, Upload } from 'lucide-react';
import { downloadFile, invalidateAll, uploadDocument, useList, useRemove, useSave, useSnapshot } from '../lib/api';
import { useForm, idOrNull } from '../lib/form';
import { cx } from '../lib/format';
import { NOTE_KINDS } from '../../shared/domain';
import { formatDate } from '../../shared/dates';
import type { DocumentMeta, Note } from '../../shared/types';
import { AssetSelect } from './TransactionForm';
import { ProjectSelect } from './work';
import { Badge, Button, Checkbox, Empty, Field, FormGrid, FormModal, Input, Panel, Select, Textarea, useConfirm, useToast } from './ui';

export interface Links { assetId?: number; opportunityId?: number; projectId?: number }

/** Renders plain text with URLs turned into safe links. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>()]+)/g);
  return (
    <p className="prose">
      {parts.map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="link">{p}</a> : p))}
    </p>
  );
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function OpportunitySelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const { data } = useSnapshot();
  return <Select id={id} value={value} onChange={onChange} placeholder="None" options={(data?.opportunities ?? []).map((o) => ({ value: String(o.id), label: o.name }))} />;
}

export function useLinkLabel() {
  const { data } = useSnapshot();
  return (x: { asset_id: number | null; opportunity_id: number | null; project_id: number | null }): ReactNode[] => {
    const out: ReactNode[] = [];
    if (x.asset_id) out.push(<Badge key="a">{data?.assets.find((a) => a.id === x.asset_id)?.name ?? 'Asset'}</Badge>);
    if (x.opportunity_id) out.push(<Badge key="o" tone="accent">{data?.opportunities.find((a) => a.id === x.opportunity_id)?.name ?? 'Opportunity'}</Badge>);
    if (x.project_id) out.push(<Badge key="p" tone="info">{data?.projects.find((a) => a.id === x.project_id)?.name ?? 'Project'}</Badge>);
    return out;
  };
}

export function NoteForm({ note, defaults, onClose, onSaved }: { note?: Note; defaults?: Links; onClose: () => void; onSaved?: (n: Note) => void }) {
  const save = useSave('notes');
  const toast = useToast();
  const f = useForm({
    title: note?.title ?? '', kind: note?.kind ?? 'research', body: note?.body ?? '', url: note?.url ?? '', tags: note?.tags ?? '',
    asset_id: String(note?.asset_id ?? defaults?.assetId ?? ''), project_id: String(note?.project_id ?? defaults?.projectId ?? ''),
    opportunity_id: String(note?.opportunity_id ?? defaults?.opportunityId ?? ''), pinned: note?.pinned ?? false,
  });
  const v = f.values;
  const submit = () =>
    save.mutateAsync({ id: note?.id, data: { ...v, asset_id: idOrNull(v.asset_id), project_id: idOrNull(v.project_id), opportunity_id: idOrNull(v.opportunity_id) } })
      .then((n) => { toast(note ? 'Note saved' : 'Note created'); onSaved?.(n); onClose(); }, f.handleError);
  return (
    <FormModal title={note ? 'Edit note' : 'New note'} onClose={onClose} onSubmit={submit} saving={save.isPending} error={f.formError} width={820}>
      <FormGrid cols={3}>
        <Field label="Title" error={f.errors.title} span={2}>{(id) => <Input id={id} value={v.title} onChange={(x) => f.set('title', x)} autoFocus />}</Field>
        <Field label="Type">{(id) => <Select id={id} value={v.kind} onChange={(x) => f.set('kind', x)} options={NOTE_KINDS} />}</Field>
        <Field label="Content" span={3} hint="Plain text. Links are clickable. Ctrl+Enter to save.">{(id) => <Textarea id={id} rows={14} value={v.body} onChange={(x) => f.set('body', x)} />}</Field>
        <Field label="Link (URL)" error={f.errors.url} span={2}>{(id) => <Input id={id} value={v.url} onChange={(x) => f.set('url', x)} placeholder="https://" />}</Field>
        <Field label="Tags" hint="Comma separated">{(id) => <Input id={id} value={v.tags} onChange={(x) => f.set('tags', x)} />}</Field>
        <Field label="Asset">{(id) => <AssetSelect id={id} value={v.asset_id} onChange={(x) => f.set('asset_id', x)} placeholder="None" />}</Field>
        <Field label="Project">{(id) => <ProjectSelect id={id} value={v.project_id} onChange={(x) => f.set('project_id', x)} />}</Field>
        <Field label="Acquisition opportunity">{(id) => <OpportunitySelect id={id} value={v.opportunity_id} onChange={(x) => f.set('opportunity_id', x)} />}</Field>
        <div className="span-3"><Checkbox checked={v.pinned} onChange={(x) => f.set('pinned', x)} label="Pin to top" /></div>
      </FormGrid>
    </FormModal>
  );
}

export function UploadForm({ defaults, onClose }: { defaults?: Links; onClose: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const f = useForm({ description: '', asset_id: String(defaults?.assetId ?? ''), project_id: String(defaults?.projectId ?? ''), opportunity_id: String(defaults?.opportunityId ?? ''), busy: false });
  const submit = async () => {
    if (!files.length) return f.setFormError('Choose at least one file.');
    const big = files.find((x) => x.size > 50 * 1024 * 1024);
    if (big) return f.setFormError(`${big.name} is larger than 50 MB.`);
    f.set('busy', true);
    try {
      for (const file of files) await uploadDocument(file, { asset_id: idOrNull(f.values.asset_id), project_id: idOrNull(f.values.project_id), opportunity_id: idOrNull(f.values.opportunity_id) }, f.values.description || undefined);
      await invalidateAll();
      toast(`Uploaded ${files.length} file${files.length > 1 ? 's' : ''}`);
      onClose();
    } catch (e) {
      f.handleError(e);
      f.set('busy', false);
    }
  };
  return (
    <FormModal title="Upload documents" onClose={onClose} onSubmit={submit} saving={f.values.busy} error={f.formError} submitLabel="Upload">
      <FormGrid cols={3}>
        <div className="span-3">
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          <Button type="button" icon={<Paperclip size={15} />} onClick={() => fileRef.current?.click()}>{files.length ? `${files.length} file${files.length > 1 ? 's' : ''} selected` : 'Choose files'}</Button>
          {files.length > 0 && <div className="cell-sub mt-sm">{files.map((x) => `${x.name} (${formatBytes(x.size)})`).join(', ')}</div>}
          <div className="field-hint mt-sm">Stored in this browser and included in every backup you download. Max 50 MB each.</div>
        </div>
        <Field label="Description" span={3}>{(id) => <Input id={id} value={f.values.description} onChange={(x) => f.set('description', x)} />}</Field>
        <Field label="Asset">{(id) => <AssetSelect id={id} value={f.values.asset_id} onChange={(x) => f.set('asset_id', x)} placeholder="None" />}</Field>
        <Field label="Project">{(id) => <ProjectSelect id={id} value={f.values.project_id} onChange={(x) => f.set('project_id', x)} />}</Field>
        <Field label="Opportunity">{(id) => <OpportunitySelect id={id} value={f.values.opportunity_id} onChange={(x) => f.set('opportunity_id', x)} />}</Field>
      </FormGrid>
    </FormModal>
  );
}

export function DocumentTable({ docs, showLinks = true }: { docs: DocumentMeta[]; showLinks?: boolean }) {
  const remove = useRemove('documents');
  const confirm = useConfirm();
  const toast = useToast();
  const linkLabel = useLinkLabel();
  if (!docs.length) return <Empty compact title="No documents" />;
  return (
    <div className="table-wrap">
      <table className="table compact">
        <thead><tr><th>File</th>{showLinks && <th>Linked to</th>}<th className="num">Size</th><th>Uploaded</th><th /></tr></thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td>
                <button type="button" className="link cell-main row gap-xs" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }} onClick={() => downloadFile(`/api/documents/${d.id}/file`, 'open').catch((e) => toast((e as Error).message, 'bad'))}><FileText size={14} /> {d.filename}</button>
                {d.description && <div className="cell-sub">{d.description}</div>}
              </td>
              {showLinks && <td><div className="row gap-xs wrap">{linkLabel(d).length ? linkLabel(d) : <span className="muted small">Holding company</span>}</div></td>}
              <td className="num subtle">{formatBytes(d.size)}</td>
              <td className="subtle small">{formatDate(d.created_at.slice(0, 10))}</td>
              <td className="actions">
                <span className="row-actions">
                  <Button size="sm" variant="ghost" icon={<Download size={13} />} aria-label="Download" onClick={() => downloadFile(`/api/documents/${d.id}/file`).catch((e) => toast((e as Error).message, 'bad'))} />
                  <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label="Delete" onClick={async () => {
                    if (await confirm({ title: `Delete ${d.filename}?`, body: 'The file is removed from this browser. Backups you downloaded earlier still contain it.', danger: true, confirmLabel: 'Delete' })) remove.mutate({ id: d.id });
                  }} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function NoteCard({ note, onEdit, active, onClick }: { note: Note; onEdit?: () => void; active?: boolean; onClick?: () => void }) {
  const linkLabel = useLinkLabel();
  return (
    <div className={cx('list-item')} style={{ cursor: onClick ? 'pointer' : undefined, background: active ? 'var(--surface-2)' : undefined, padding: '10px 12px', borderRadius: 8 }} onClick={onClick}>
      <div className="grow">
        <div className="row gap-sm">
          {note.pinned && <Pin size={12} style={{ color: 'var(--accent)' }} />}
          <span className="cell-main ellipsis">{note.title}</span>
        </div>
        <div className="cell-sub ellipsis">{NOTE_KINDS[note.kind]} · {formatDate(note.updated_at.slice(0, 10))}{note.body ? ` · ${note.body.slice(0, 80)}` : ''}</div>
        <div className="row gap-xs wrap" style={{ marginTop: 4 }}>{linkLabel(note)}</div>
      </div>
      {onEdit && <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={(e) => { e.stopPropagation(); onEdit(); }} aria-label="Edit" />}
    </div>
  );
}

/** Notes and documents linked to an asset, opportunity or project. */
export function LinkedKnowledge(links: Links) {
  const filter = links.assetId ? { asset_id: links.assetId } : links.opportunityId ? { opportunity_id: links.opportunityId } : { project_id: links.projectId };
  const { data: notes = [] } = useList('notes', filter);
  const { data: docs = [] } = useList('documents', filter);
  const [editing, setEditing] = useState<Note | 'new' | null>(null);
  const [viewing, setViewing] = useState<Note | null>(null);
  const [uploading, setUploading] = useState(false);
  return (
    <div className="grid grid-2">
      <Panel title="Notes" sub={`${notes.length} linked`} actions={<Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setEditing('new')}>Note</Button>}>
        {notes.length ? <div className="list">{notes.map((n) => <NoteCard key={n.id} note={n} onClick={() => setViewing(n)} onEdit={() => setEditing(n)} />)}</div> : <Empty compact title="No notes yet" />}
      </Panel>
      <Panel title="Documents" sub={`${docs.length} linked`} pad={false} actions={<Button size="sm" icon={<Upload size={14} />} onClick={() => setUploading(true)}>Upload</Button>}>
        <div style={{ paddingTop: 10 }}><DocumentTable docs={docs} showLinks={false} /></div>
      </Panel>
      {editing && <NoteForm note={editing === 'new' ? undefined : editing} defaults={links} onClose={() => setEditing(null)} />}
      {uploading && <UploadForm defaults={links} onClose={() => setUploading(false)} />}
      {viewing && <NoteViewer note={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); }} />}
    </div>
  );
}

export function NoteViewer({ note, onClose, onEdit }: { note: Note; onClose: () => void; onEdit: () => void }) {
  return (
    <FormModal title={note.title} onClose={onClose} onSubmit={onEdit} submitLabel="Edit" width={760}>
      <NoteBody note={note} />
    </FormModal>
  );
}

export function NoteBody({ note }: { note: Note }) {
  const linkLabel = useLinkLabel();
  return (
    <div className="stack gap-md">
      <div className="row gap-sm wrap">
        <Badge tone="accent">{NOTE_KINDS[note.kind]}</Badge>
        {linkLabel(note)}
        {note.tags?.split(',').map((t) => t.trim()).filter(Boolean).map((t) => <Badge key={t}>#{t}</Badge>)}
        <span className="muted small">Updated {formatDate(note.updated_at.slice(0, 10))}</span>
      </div>
      {note.url && <a href={note.url} target="_blank" rel="noreferrer noopener" className="link row gap-xs">{note.url} <ExternalLink size={12} /></a>}
      {note.body ? <RichText text={note.body} /> : <span className="muted">No content.</span>}
    </div>
  );
}
