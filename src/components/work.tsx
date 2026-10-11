import { useMemo, useState, type ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Flag, Pencil, Plus, Trash2, CheckCircle2, Circle } from 'lucide-react';
import { usePatch, useRemove, useSave, useSnapshot } from '../lib/api';
import { useForm, idOrNull } from '../lib/form';
import { cx } from '../lib/format';
import { MILESTONE_KINDS, PRIORITIES, PRIORITY_RANK, PROJECT_STATUSES, TASK_STATUSES, type Priority, type TaskStatus } from '../../shared/domain';
import { addDays, addMonths, daysBetween, formatDate, formatMonth, todayISO } from '../../shared/dates';
import { isOverdue } from '../../shared/insights';
import type { Milestone, Project, Task } from '../../shared/types';
import { AssetSelect } from './TransactionForm';
import { Badge, Button, Empty, Field, FormGrid, FormModal, Input, Panel, Progress, Select, Textarea, useConfirm, useToast } from './ui';

export const PRIORITY_TONE: Record<Priority, 'bad' | 'warn' | 'info' | 'neutral'> = { critical: 'bad', high: 'warn', medium: 'info', low: 'neutral' };
const STATUS_ORDER: TaskStatus[] = ['backlog', 'next', 'in_progress', 'waiting', 'completed'];

function useLookups() {
  const { data } = useSnapshot();
  return {
    assetName: (id: number | null) => (id ? data?.assets.find((a) => a.id === id)?.name : null) ?? 'Holding company',
    projectName: (id: number | null) => (id ? data?.projects.find((p) => p.id === id)?.name : null) ?? null,
    projects: data?.projects ?? [],
  };
}

export function ProjectSelect({ value, onChange, id, assetId }: { value: string; onChange: (v: string) => void; id?: string; assetId?: string }) {
  const { projects } = useLookups();
  const list = projects.filter((p) => !assetId || String(p.asset_id ?? '') === assetId || String(p.id) === value);
  return <Select id={id} value={value} onChange={onChange} placeholder="No project" options={list.map((p) => ({ value: String(p.id), label: p.name }))} />;
}

// ------------------------------------------------------------------ Forms
export function TaskForm({ task, defaults, onClose }: { task?: Task; defaults?: Partial<Task>; onClose: () => void }) {
  const save = useSave('tasks');
  const remove = useRemove('tasks');
  const confirm = useConfirm();
  const toast = useToast();
  const base = { ...defaults, ...task };
  const f = useForm({
    title: base.title ?? '', description: base.description ?? '', asset_id: String(base.asset_id ?? ''), project_id: String(base.project_id ?? ''),
    priority: base.priority ?? 'medium', status: base.status ?? 'next', deadline: base.deadline ?? '', notes: base.notes ?? '', completed_at: base.completed_at ?? '',
  });
  const v = f.values;
  const submit = () =>
    save
      .mutateAsync({ id: task?.id, data: { ...v, asset_id: idOrNull(v.asset_id), project_id: idOrNull(v.project_id), deadline: v.deadline || null, completed_at: v.status === 'completed' ? v.completed_at || null : null, sort_order: task?.sort_order ?? Date.now() / 1e6 } })
      .then(() => { toast(task ? 'Task updated' : 'Task created'); onClose(); }, f.handleError);
  return (
    <FormModal
      title={task ? 'Edit task' : 'New task'}
      onClose={onClose}
      onSubmit={submit}
      saving={save.isPending}
      error={f.formError}
      extraActions={task && <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={async () => { if (await confirm({ title: 'Delete task?', danger: true, confirmLabel: 'Delete' })) { await remove.mutateAsync({ id: task.id }); onClose(); } }}>Delete</Button>}
    >
      <FormGrid cols={2}>
        <Field label="Title" error={f.errors.title} span={2}>{(id) => <Input id={id} value={v.title} onChange={(x) => f.set('title', x)} autoFocus />}</Field>
        <Field label="Asset">{(id) => <AssetSelect id={id} value={v.asset_id} onChange={(x) => f.set('asset_id', x)} />}</Field>
        <Field label="Project">{(id) => <ProjectSelect id={id} value={v.project_id} onChange={(x) => f.set('project_id', x)} assetId={v.asset_id || undefined} />}</Field>
        <Field label="Priority">{(id) => <Select id={id} value={v.priority} onChange={(x) => f.set('priority', x)} options={PRIORITIES} />}</Field>
        <Field label="Status">{(id) => <Select id={id} value={v.status} onChange={(x) => f.set('status', x)} options={TASK_STATUSES} />}</Field>
        <Field label="Deadline" error={f.errors.deadline}>{(id) => <Input id={id} type="date" value={v.deadline} onChange={(x) => f.set('deadline', x)} />}</Field>
        {v.status === 'completed' ? (
          <Field label="Completed on" hint="Defaults to today">{(id) => <Input id={id} type="date" value={v.completed_at} onChange={(x) => f.set('completed_at', x)} />}</Field>
        ) : <div />}
        <Field label="Description" span={2}>{(id) => <Textarea id={id} rows={3} value={v.description} onChange={(x) => f.set('description', x)} />}</Field>
        <Field label="Notes" span={2}>{(id) => <Textarea id={id} rows={2} value={v.notes} onChange={(x) => f.set('notes', x)} />}</Field>
      </FormGrid>
    </FormModal>
  );
}

export function ProjectForm({ project, defaults, onClose }: { project?: Project; defaults?: Partial<Project>; onClose: () => void }) {
  const save = useSave('projects');
  const base = { ...defaults, ...project };
  const f = useForm({ name: base.name ?? '', asset_id: String(base.asset_id ?? ''), description: base.description ?? '', status: base.status ?? 'active', start_date: base.start_date ?? todayISO(), target_date: base.target_date ?? '' });
  const v = f.values;
  return (
    <FormModal title={project ? 'Edit project' : 'New project'} onClose={onClose} saving={save.isPending} error={f.formError}
      onSubmit={() => save.mutateAsync({ id: project?.id, data: { ...v, asset_id: idOrNull(v.asset_id), start_date: v.start_date || null, target_date: v.target_date || null } }).then(onClose, f.handleError)}>
      <FormGrid cols={2}>
        <Field label="Name" error={f.errors.name} span={2}>{(id) => <Input id={id} value={v.name} onChange={(x) => f.set('name', x)} autoFocus />}</Field>
        <Field label="Asset">{(id) => <AssetSelect id={id} value={v.asset_id} onChange={(x) => f.set('asset_id', x)} />}</Field>
        <Field label="Status">{(id) => <Select id={id} value={v.status} onChange={(x) => f.set('status', x)} options={PROJECT_STATUSES} />}</Field>
        <Field label="Start date">{(id) => <Input id={id} type="date" value={v.start_date} onChange={(x) => f.set('start_date', x)} />}</Field>
        <Field label="Target date">{(id) => <Input id={id} type="date" value={v.target_date} onChange={(x) => f.set('target_date', x)} />}</Field>
        <Field label="Description" span={2}>{(id) => <Textarea id={id} rows={3} value={v.description} onChange={(x) => f.set('description', x)} />}</Field>
      </FormGrid>
    </FormModal>
  );
}

export function MilestoneForm({ milestone, defaults, onClose }: { milestone?: Milestone; defaults?: Partial<Milestone>; onClose: () => void }) {
  const save = useSave('milestones');
  const base = { ...defaults, ...milestone };
  const f = useForm({ title: base.title ?? '', asset_id: String(base.asset_id ?? ''), project_id: String(base.project_id ?? ''), kind: base.kind ?? 'launch', description: base.description ?? '', target_date: base.target_date ?? '', completed_at: base.completed_at ?? '' });
  const v = f.values;
  return (
    <FormModal title={milestone ? 'Edit milestone' : 'New milestone'} onClose={onClose} saving={save.isPending} error={f.formError}
      onSubmit={() => save.mutateAsync({ id: milestone?.id, data: { ...v, asset_id: idOrNull(v.asset_id), project_id: idOrNull(v.project_id), target_date: v.target_date || null, completed_at: v.completed_at || null } }).then(onClose, f.handleError)}>
      <FormGrid cols={2}>
        <Field label="Title" error={f.errors.title} span={2}>{(id) => <Input id={id} value={v.title} onChange={(x) => f.set('title', x)} placeholder="e.g. Launch website, reach £5k MRR, publish game" autoFocus />}</Field>
        <Field label="Asset">{(id) => <AssetSelect id={id} value={v.asset_id} onChange={(x) => f.set('asset_id', x)} />}</Field>
        <Field label="Type">{(id) => <Select id={id} value={v.kind} onChange={(x) => f.set('kind', x)} options={MILESTONE_KINDS} />}</Field>
        <Field label="Target date">{(id) => <Input id={id} type="date" value={v.target_date} onChange={(x) => f.set('target_date', x)} />}</Field>
        <Field label="Achieved on" hint="Leave blank until achieved">{(id) => <Input id={id} type="date" value={v.completed_at} onChange={(x) => f.set('completed_at', x)} />}</Field>
        <Field label="Project">{(id) => <ProjectSelect id={id} value={v.project_id} onChange={(x) => f.set('project_id', x)} assetId={v.asset_id || undefined} />}</Field>
        <div />
        <Field label="Description" span={2}>{(id) => <Textarea id={id} rows={2} value={v.description} onChange={(x) => f.set('description', x)} />}</Field>
      </FormGrid>
    </FormModal>
  );
}

// ------------------------------------------------------------------ Views
function DeadlineLabel({ task }: { task: Task }) {
  if (!task.deadline) return null;
  const today = todayISO();
  const d = daysBetween(today, task.deadline);
  const late = isOverdue(task, today);
  return <span className={cx(late ? 'tone-bad' : d <= 3 && task.status !== 'completed' ? 'tone-warn' : undefined)}><CalendarDays size={11} style={{ verticalAlign: -1 }} /> {formatDate(task.deadline)}</span>;
}

export function TaskBoard({ tasks, onOpen, onCreate }: { tasks: Task[]; onOpen: (t: Task) => void; onCreate: (status: TaskStatus) => void }) {
  const patch = usePatch('tasks');
  const { assetName } = useLookups();
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const byStatus = (s: TaskStatus) => tasks.filter((t) => t.status === s).sort((a, b) => a.sort_order - b.sort_order || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  const drop = (status: TaskStatus, beforeId: number | null) => {
    setOver(null);
    if (dragId === null) return;
    const col = byStatus(status).filter((t) => t.id !== dragId);
    const idx = beforeId === null ? col.length : col.findIndex((t) => t.id === beforeId);
    const prev = col[idx - 1]?.sort_order;
    const next = col[idx]?.sort_order;
    const sort_order = prev === undefined && next === undefined ? 1 : prev === undefined ? next! - 1 : next === undefined ? prev + 1 : (prev + next) / 2;
    patch.mutate({ id: dragId, data: { status, sort_order } });
    setDragId(null);
  };
  return (
    <div className="kanban">
      {STATUS_ORDER.map((s) => {
        const col = byStatus(s);
        return (
          <div key={s} className={cx('kanban-col', over === s && 'drag-over')} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={() => drop(s, null)}>
            <div className="kanban-head">
              <span>{TASK_STATUSES[s]} <span className="muted">{col.length}</span></span>
              <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => onCreate(s)} aria-label={`Add to ${TASK_STATUSES[s]}`} />
            </div>
            <div className="kanban-body">
              {col.map((t) => (
                <div key={t.id} className={cx('card', dragId === t.id && 'dragging')} draggable onDragStart={() => setDragId(t.id)} onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.stopPropagation(); drop(s, t.id); }} onClick={() => onOpen(t)}>
                  <div className="card-title">{t.title}</div>
                  <div className="card-meta">
                    <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITIES[t.priority]}</Badge>
                    <span className="ellipsis" style={{ maxWidth: 120 }}>{assetName(t.asset_id)}</span>
                    <DeadlineLabel task={t} />
                  </div>
                </div>
              ))}
              {!col.length && <div className="muted small" style={{ textAlign: 'center', padding: 14 }}>Drop tasks here</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type SortKey = 'deadline' | 'priority' | 'status' | 'title';
export function TaskTable({ tasks, onOpen, showAsset = true }: { tasks: Task[]; onOpen: (t: Task) => void; showAsset?: boolean }) {
  const patch = usePatch('tasks');
  const { assetName, projectName } = useLookups();
  const [sort, setSort] = useState<SortKey>('deadline');
  const sorted = useMemo(() => {
    const cmp: Record<SortKey, (a: Task, b: Task) => number> = {
      deadline: (a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'),
      priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
      status: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
      title: (a, b) => a.title.localeCompare(b.title),
    };
    return [...tasks].sort((a, b) => cmp[sort](a, b) || a.id - b.id);
  }, [tasks, sort]);
  if (!tasks.length) return <Empty compact title="No tasks" />;
  const th = (k: SortKey, label: string) => <th className="sortable" onClick={() => setSort(k)}>{label}{sort === k ? ' ↓' : ''}</th>;
  return (
    <div className="table-wrap">
      <table className="table compact">
        <thead><tr><th style={{ width: 30 }} />{th('title', 'Task')}{showAsset && <th>Asset / project</th>}{th('priority', 'Priority')}{th('status', 'Status')}{th('deadline', 'Deadline')}<th>Completed</th></tr></thead>
        <tbody>
          {sorted.map((t) => (
            <tr key={t.id} className="clickable" onClick={() => onOpen(t)}>
              <td onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-ghost btn-sm btn-icon" aria-label={t.status === 'completed' ? 'Reopen' : 'Complete'} onClick={() => patch.mutate({ id: t.id, data: { status: t.status === 'completed' ? 'next' : 'completed' } })}>
                  {t.status === 'completed' ? <CheckCircle2 size={16} className="tone-good" /> : <Circle size={16} className="muted" />}
                </button>
              </td>
              <td><div className={cx('cell-main', t.status === 'completed' && 'muted')} style={t.status === 'completed' ? { textDecoration: 'line-through' } : undefined}>{t.title}</div>{t.description && <div className="cell-sub ellipsis" style={{ maxWidth: 380 }}>{t.description}</div>}</td>
              {showAsset && <td className="subtle">{assetName(t.asset_id)}{projectName(t.project_id) && <div className="cell-sub">{projectName(t.project_id)}</div>}</td>}
              <td><Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITIES[t.priority]}</Badge></td>
              <td className="subtle">{TASK_STATUSES[t.status]}</td>
              <td className="small"><DeadlineLabel task={t} /></td>
              <td className="subtle small">{formatDate(t.completed_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DeadlineCalendar({ tasks, milestones, onOpenTask, onOpenMilestone }: { tasks: Task[]; milestones: Milestone[]; onOpenTask: (t: Task) => void; onOpenMilestone: (m: Milestone) => void }) {
  const today = todayISO();
  const [month, setMonth] = useState(today.slice(0, 7));
  const first = `${month}-01`;
  const dow = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday first
  const start = addDays(first, -dow);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const items: Record<string, ReactNode[]> = {};
  for (const t of tasks) if (t.deadline) (items[t.deadline] ??= []).push(
    <div key={`t${t.id}`} className={cx('cal-item', isOverdue(t, today) && 'overdue', t.status === 'completed' && 'done')} onClick={() => onOpenTask(t)} title={t.title}>{t.title}</div>,
  );
  for (const m of milestones) if (m.target_date) (items[m.target_date] ??= []).push(
    <div key={`m${m.id}`} className={cx('cal-item', 'milestone', m.completed_at && 'done')} onClick={() => onOpenMilestone(m)} title={m.title}><Flag size={10} style={{ verticalAlign: -1 }} /> {m.title}</div>,
  );
  return (
    <Panel pad={false} title={formatMonth(month, true)} actions={
      <>
        <Button size="sm" variant="ghost" icon={<ChevronLeft size={15} />} onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month" />
        <Button size="sm" onClick={() => setMonth(today.slice(0, 7))}>Today</Button>
        <Button size="sm" variant="ghost" icon={<ChevronRight size={15} />} onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month" />
      </>
    }>
      <div style={{ padding: '12px 0 0' }}>
        <div className="calendar">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cal-dow">{d}</div>)}
          {days.map((d) => (
            <div key={d} className={cx('cal-cell', d.slice(0, 7) !== month && 'outside', d === today && 'today')}>
              <div className="cal-day">{Number(d.slice(8))}</div>
              {items[d]}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

export function MilestoneList({ milestones, onOpen, showAsset = true }: { milestones: Milestone[]; onOpen: (m: Milestone) => void; showAsset?: boolean }) {
  const patch = usePatch('milestones');
  const { assetName } = useLookups();
  const today = todayISO();
  if (!milestones.length) return <Empty compact title="No milestones" />;
  return (
    <table className="table compact">
      <thead><tr><th style={{ width: 30 }} /><th>Milestone</th>{showAsset && <th>Asset</th>}<th>Type</th><th>Target</th><th>Achieved</th></tr></thead>
      <tbody>
        {milestones.map((m) => {
          const late = !m.completed_at && m.target_date && m.target_date < today;
          return (
            <tr key={m.id} className="clickable" onClick={() => onOpen(m)}>
              <td onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-ghost btn-sm btn-icon" aria-label="Toggle achieved" onClick={() => patch.mutate({ id: m.id, data: { completed_at: m.completed_at ? null : today } })}>
                  {m.completed_at ? <CheckCircle2 size={16} className="tone-good" /> : <Circle size={16} className="muted" />}
                </button>
              </td>
              <td><div className="cell-main">{m.title}</div>{m.description && <div className="cell-sub ellipsis" style={{ maxWidth: 360 }}>{m.description}</div>}</td>
              {showAsset && <td className="subtle">{assetName(m.asset_id)}</td>}
              <td><Badge tone="accent">{MILESTONE_KINDS[m.kind]}</Badge></td>
              <td className={cx('small', late ? 'tone-bad' : 'subtle')}>{formatDate(m.target_date)}</td>
              <td className="small subtle">{formatDate(m.completed_at)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ProjectList({ projects, tasks, onOpen, onFilter, showAsset = true }: { projects: Project[]; tasks: Task[]; onOpen: (p: Project) => void; onFilter?: (p: Project) => void; showAsset?: boolean }) {
  const { assetName } = useLookups();
  const remove = useRemove('projects');
  const confirm = useConfirm();
  if (!projects.length) return <Empty compact title="No projects" />;
  return (
    <table className="table">
      <thead><tr><th>Project</th>{showAsset && <th>Asset</th>}<th>Status</th><th>Progress</th><th>Target</th><th /></tr></thead>
      <tbody>
        {projects.map((p) => {
          const pt = tasks.filter((t) => t.project_id === p.id);
          const done = pt.filter((t) => t.status === 'completed').length;
          return (
            <tr key={p.id} className="clickable" onClick={() => (onFilter ?? onOpen)(p)}>
              <td><div className="cell-main">{p.name}</div>{p.description && <div className="cell-sub ellipsis" style={{ maxWidth: 360 }}>{p.description}</div>}</td>
              {showAsset && <td className="subtle">{assetName(p.asset_id)}</td>}
              <td><Badge tone={p.status === 'active' ? 'info' : p.status === 'completed' ? 'good' : 'neutral'}>{PROJECT_STATUSES[p.status]}</Badge></td>
              <td style={{ minWidth: 150 }}>
                <div className="row gap-sm"><div className="grow"><Progress value={pt.length ? done / pt.length : null} /></div><span className="small muted">{done}/{pt.length}</span></div>
              </td>
              <td className="subtle small">{formatDate(p.target_date)}</td>
              <td className="actions" onClick={(e) => e.stopPropagation()}>
                <span className="row-actions">
                  <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => onOpen(p)} aria-label="Edit" />
                  <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label="Delete" onClick={async () => {
                    if (await confirm({ title: `Delete project “${p.name}”?`, body: 'Its tasks and milestones are kept and simply unlinked from the project.', danger: true, confirmLabel: 'Delete' })) remove.mutate({ id: p.id });
                  }} />
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
