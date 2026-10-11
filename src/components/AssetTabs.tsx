import { useState } from 'react';
import { Flag, FolderKanban, Plus } from 'lucide-react';
import { useSnapshot } from '../lib/api';
import type { Milestone, Project, Task } from '../../shared/types';
import { MilestoneForm, MilestoneList, ProjectForm, ProjectList, TaskForm, TaskTable } from './work';
import { Button, Empty, Panel, Segmented } from './ui';

export function AssetWorkTab({ assetId }: { assetId: number }) {
  const { data: s } = useSnapshot();
  const [show, setShow] = useState<'open' | 'all'>('open');
  const [taskEdit, setTaskEdit] = useState<Task | 'new' | null>(null);
  const [projectEdit, setProjectEdit] = useState<Project | 'new' | null>(null);
  const [milestoneEdit, setMilestoneEdit] = useState<Milestone | 'new' | null>(null);
  if (!s) return null;
  const tasks = s.tasks.filter((t) => t.asset_id === assetId && (show === 'all' || t.status !== 'completed'));
  return (
    <div className="grid">
      <Panel title="Tasks" pad={false} actions={
        <>
          <Segmented value={show} onChange={setShow} options={[{ key: 'open', label: 'Open' }, { key: 'all', label: 'All' }]} />
          <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setTaskEdit('new')}>Task</Button>
        </>
      }>
        <div style={{ paddingTop: 10 }}><TaskTable tasks={tasks} onOpen={setTaskEdit} showAsset={false} /></div>
      </Panel>
      <div className="grid grid-2">
        <Panel title="Projects" pad={false} actions={<Button size="sm" icon={<FolderKanban size={14} />} onClick={() => setProjectEdit('new')}>Project</Button>}>
          <div style={{ paddingTop: 10 }}><ProjectList projects={s.projects.filter((p) => p.asset_id === assetId)} tasks={s.tasks} onOpen={setProjectEdit} showAsset={false} /></div>
        </Panel>
        <Panel title="Milestones" pad={false} actions={<Button size="sm" icon={<Flag size={14} />} onClick={() => setMilestoneEdit('new')}>Milestone</Button>}>
          <div style={{ paddingTop: 10 }}><MilestoneList milestones={s.milestones.filter((m) => m.asset_id === assetId)} onOpen={setMilestoneEdit} showAsset={false} /></div>
        </Panel>
      </div>
      {taskEdit && <TaskForm task={taskEdit === 'new' ? undefined : taskEdit} defaults={{ asset_id: assetId }} onClose={() => setTaskEdit(null)} />}
      {projectEdit && <ProjectForm project={projectEdit === 'new' ? undefined : projectEdit} defaults={{ asset_id: assetId }} onClose={() => setProjectEdit(null)} />}
      {milestoneEdit && <MilestoneForm milestone={milestoneEdit === 'new' ? undefined : milestoneEdit} defaults={{ asset_id: assetId }} onClose={() => setMilestoneEdit(null)} />}
    </div>
  );
}

export function AssetGoalsTab(_: { assetId: number }) {
  return <Empty title="Goals arrive in a later phase" />;
}
export function AssetKnowledgeTab(_: { assetId: number }) {
  return <Empty title="Notes arrive in phase 5" />;
}
