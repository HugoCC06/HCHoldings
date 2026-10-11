import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, Flag, FolderKanban, KanbanSquare, List, Plus } from 'lucide-react';
import { useSnapshot } from '../lib/api';
import { PRIORITIES, type TaskStatus } from '../../shared/domain';
import { todayISO } from '../../shared/dates';
import { isOverdue } from '../../shared/insights';
import type { Milestone, Project, Task } from '../../shared/types';
import { DeadlineCalendar, MilestoneForm, MilestoneList, ProjectForm, ProjectList, TaskBoard, TaskForm, TaskTable } from '../components/work';
import { Button, ErrorBox, Input, Loading, PageHeader, Panel, Segmented, Select } from '../components/ui';

type View = 'board' | 'list' | 'calendar' | 'projects' | 'milestones';

export function WorkPage() {
  const { data: s, isLoading, error } = useSnapshot();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as View) || 'board';
  const [asset, setAsset] = useState('any');
  const [project, setProject] = useState(params.get('project') ?? '');
  const [priority, setPriority] = useState('');
  const [showDone, setShowDone] = useState<'open' | 'all' | 'overdue'>('open');
  const [q, setQ] = useState('');
  const [taskEdit, setTaskEdit] = useState<{ task?: Task; defaults?: Partial<Task> } | null>(null);
  const [projectEdit, setProjectEdit] = useState<Project | 'new' | null>(null);
  const [milestoneEdit, setMilestoneEdit] = useState<Milestone | 'new' | null>(null);

  // Deep links: ?task=ID opens a task, ?new=1 creates one.
  useEffect(() => {
    if (!s) return;
    const tid = params.get('task');
    if (tid) {
      const t = s.tasks.find((x) => x.id === Number(tid));
      if (t) setTaskEdit({ task: t });
    }
    if (params.get('new') === '1') setTaskEdit({});
    if (tid || params.get('new')) {
      params.delete('task');
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [s, params, setParams]);

  const today = todayISO();
  const tasks = useMemo(() => (s?.tasks ?? []).filter((t) =>
    (asset === 'any' || (asset === '' ? t.asset_id === null : t.asset_id === Number(asset))) &&
    (!project || t.project_id === Number(project)) &&
    (!priority || t.priority === priority) &&
    (!q || `${t.title} ${t.description ?? ''} ${t.notes ?? ''}`.toLowerCase().includes(q.toLowerCase())),
  ), [s, asset, project, priority, q]);
  const milestones = useMemo(() => (s?.milestones ?? []).filter((m) => asset === 'any' || (asset === '' ? m.asset_id === null : m.asset_id === Number(asset))), [s, asset]);

  if (isLoading) return <Loading />;
  if (error || !s) return <ErrorBox error={error} />;
  const setView = (v: View) => { params.set('view', v); setParams(params); };
  const listTasks = tasks.filter((t) => (showDone === 'all' ? true : showDone === 'overdue' ? isOverdue(t, today) : t.status !== 'completed'));
  const overdue = s.tasks.filter((t) => isOverdue(t, today)).length;
  const projects = s.projects.filter((p) => asset === 'any' || (asset === '' ? p.asset_id === null : p.asset_id === Number(asset)));

  return (
    <>
      <PageHeader
        title="Projects & tasks"
        subtitle={`${s.tasks.filter((t) => t.status !== 'completed').length} open tasks · ${overdue} overdue · ${s.projects.filter((p) => p.status === 'active').length} active projects`}
        actions={
          <>
            <Button icon={<Flag size={15} />} onClick={() => setMilestoneEdit('new')}>Milestone</Button>
            <Button icon={<FolderKanban size={15} />} onClick={() => setProjectEdit('new')}>Project</Button>
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => setTaskEdit({ defaults: { asset_id: asset && asset !== 'any' ? Number(asset) : null, project_id: project ? Number(project) : null } })}>Task</Button>
          </>
        }
      />
      <div className="filters">
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { key: 'board', label: 'Board', icon: <KanbanSquare size={14} /> },
            { key: 'list', label: 'List', icon: <List size={14} /> },
            { key: 'calendar', label: 'Calendar', icon: <CalendarDays size={14} /> },
            { key: 'projects', label: 'Projects', icon: <FolderKanban size={14} /> },
            { key: 'milestones', label: 'Milestones', icon: <Flag size={14} /> },
          ]}
        />
        <div className="grow" />
        {(view === 'board' || view === 'list' || view === 'calendar') && <Input className="search-input" placeholder="Search tasks…" value={q} onChange={setQ} />}
        <select className="input select" value={asset} onChange={(e) => setAsset(e.target.value)} aria-label="Asset">
          <option value="any">All assets</option>
          <option value="">Holding company</option>
          {s.assets.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {(view === 'board' || view === 'list') && (
          <>
            <Select value={project} onChange={setProject} placeholder="All projects" options={s.projects.map((p) => ({ value: String(p.id), label: p.name }))} />
            <Select value={priority} onChange={setPriority} placeholder="Any priority" options={PRIORITIES} />
          </>
        )}
        {view === 'list' && <Select value={showDone} onChange={(v) => setShowDone(v)} options={{ open: 'Open tasks', overdue: 'Overdue only', all: 'Including completed' }} />}
      </div>

      {view === 'board' && <TaskBoard tasks={tasks} onOpen={(t) => setTaskEdit({ task: t })} onCreate={(status: TaskStatus) => setTaskEdit({ defaults: { status, asset_id: asset && asset !== 'any' ? Number(asset) : null, project_id: project ? Number(project) : null } })} />}
      {view === 'list' && <Panel pad={false}><TaskTable tasks={listTasks} onOpen={(t) => setTaskEdit({ task: t })} /></Panel>}
      {view === 'calendar' && <DeadlineCalendar tasks={tasks} milestones={milestones} onOpenTask={(t) => setTaskEdit({ task: t })} onOpenMilestone={setMilestoneEdit} />}
      {view === 'projects' && (
        <Panel pad={false} sub="Click a project to see its tasks on the board">
          <ProjectList projects={projects} tasks={s.tasks} onOpen={setProjectEdit} onFilter={(p) => { setProject(String(p.id)); setView('board'); }} />
        </Panel>
      )}
      {view === 'milestones' && <Panel pad={false}><MilestoneList milestones={milestones} onOpen={setMilestoneEdit} /></Panel>}

      {taskEdit && <TaskForm task={taskEdit.task} defaults={taskEdit.defaults} onClose={() => setTaskEdit(null)} />}
      {projectEdit && <ProjectForm project={projectEdit === 'new' ? undefined : projectEdit} defaults={asset && asset !== 'any' ? { asset_id: Number(asset) } : undefined} onClose={() => setProjectEdit(null)} />}
      {milestoneEdit && <MilestoneForm milestone={milestoneEdit === 'new' ? undefined : milestoneEdit} defaults={asset && asset !== 'any' ? { asset_id: Number(asset) } : undefined} onClose={() => setMilestoneEdit(null)} />}
    </>
  );
}
