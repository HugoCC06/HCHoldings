import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useList, useRemove } from '../lib/api';
import { NOTE_KINDS } from '../../shared/domain';
import type { Note } from '../../shared/types';
import { DocumentTable, NoteBody, NoteCard, NoteForm, UploadForm } from '../components/knowledge';
import { Button, Empty, Input, Loading, PageHeader, Panel, Select, Tabs, useConfirm } from '../components/ui';
import { AssetSelect } from '../components/TransactionForm';

type Tab = 'notes' | 'documents';

export function KnowledgePage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'notes';
  const { data: notes = [], isLoading } = useList('notes');
  const { data: docs = [] } = useList('documents');
  const remove = useRemove('notes');
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [asset, setAsset] = useState('');
  const [selected, setSelected] = useState<number | null>(params.get('note') ? Number(params.get('note')) : null);
  const [editing, setEditing] = useState<Note | 'new' | null>(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    const n = params.get('note');
    if (n) setSelected(Number(n));
  }, [params]);

  const needle = q.trim().toLowerCase();
  const filteredNotes = useMemo(() => notes.filter((n) =>
    (!kind || n.kind === kind) && (!asset || n.asset_id === Number(asset)) &&
    (!needle || `${n.title} ${n.body ?? ''} ${n.tags ?? ''} ${n.url ?? ''}`.toLowerCase().includes(needle)),
  ), [notes, kind, asset, needle]);
  const filteredDocs = useMemo(() => docs.filter((d) => (!asset || d.asset_id === Number(asset)) && (!needle || `${d.filename} ${d.description ?? ''}`.toLowerCase().includes(needle))), [docs, asset, needle]);
  const current = notes.find((n) => n.id === selected) ?? filteredNotes[0];

  if (isLoading) return <Loading />;
  return (
    <>
      <PageHeader
        title="Notes & documents"
        subtitle="Ideas, theses, research, decisions, roadmaps, links and lessons — linked to assets, projects and opportunities."
        actions={
          <>
            <Button icon={<Upload size={15} />} onClick={() => setUploading(true)}>Upload</Button>
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing('new')}>Note</Button>
          </>
        }
      />
      <Tabs<Tab> value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ key: 'notes', label: 'Notes', count: notes.length }, { key: 'documents', label: 'Documents', count: docs.length }]} />
      <div className="filters">
        <Input className="search-input" placeholder={tab === 'notes' ? 'Search titles, content, tags…' : 'Search files…'} value={q} onChange={setQ} />
        {tab === 'notes' && <Select value={kind} onChange={setKind} options={NOTE_KINDS} placeholder="All types" />}
        <AssetSelect value={asset} onChange={setAsset} placeholder="All assets" />
      </div>
      {tab === 'notes' ? (
        notes.length ? (
          <div className="grid split">
            <Panel pad={false}>
              <div className="list" style={{ padding: 6, maxHeight: '70vh', overflowY: 'auto' }}>
                {filteredNotes.length ? filteredNotes.map((n) => <NoteCard key={n.id} note={n} active={current?.id === n.id} onClick={() => setSelected(n.id)} />) : <Empty compact title="No matching notes" />}
              </div>
            </Panel>
            <Panel title={current?.title} actions={current && (
              <>
                <Button size="sm" icon={<Pencil size={14} />} onClick={() => setEditing(current)}>Edit</Button>
                <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label="Delete" onClick={async () => {
                  if (await confirm({ title: `Delete “${current.title}”?`, danger: true, confirmLabel: 'Delete' })) { remove.mutate({ id: current.id }); setSelected(null); }
                }} />
              </>
            )}>
              {current ? <NoteBody note={current} /> : <Empty compact title="Select a note" />}
            </Panel>
          </div>
        ) : (
          <Panel><Empty title="No notes yet" action={<Button variant="primary" onClick={() => setEditing('new')}>Write your first note</Button>}>Capture investment theses, research, decisions and lessons learned.</Empty></Panel>
        )
      ) : (
        <Panel pad={false}>
          {docs.length ? <DocumentTable docs={filteredDocs} /> : <Empty title="No documents yet" action={<Button variant="primary" onClick={() => setUploading(true)}>Upload documents</Button>}>Contracts, financial statements, due diligence packs, screenshots…</Empty>}
        </Panel>
      )}
      {editing && <NoteForm note={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={(n) => setSelected(n.id)} />}
      {uploading && <UploadForm onClose={() => setUploading(false)} />}
    </>
  );
}
