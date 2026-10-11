import { useState } from 'react';
import { Flag, FolderKanban, Plus } from 'lucide-react';
import { useSnapshot } from '../lib/api';
import type { Goal, Milestone, Project, Task } from '../../shared/types';
import { MilestoneForm, MilestoneList, ProjectForm, ProjectList, TaskForm, TaskTable } from './work';
import { Button, Panel, Segmented } from './ui';
import { GoalForm, GoalsTable, MetricsPanel, ReviewEditor } from './performance';
import { LinkedKnowledge } from './knowledge';

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

export function AssetGoalsTab({ assetId }: { assetId: number }) {
  const { data: s } = useSnapshot();
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  if (!s) return null;
  return (
    <div className="grid">
      <Panel title="Goals" sub="Actual performance against your targets" pad={false} actions={<Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setEditing('new')}>Goal</Button>}>
        <div style={{ paddingTop: 10 }}><GoalsTable goals={s.goals.filter((g) => g.asset_id === assetId)} showAsset={false} onEdit={setEditing} /></div>
      </Panel>
      <MetricsPanel assetId={assetId} />
      <ReviewEditor assetId={assetId} />
      {editing && <GoalForm goal={editing === 'new' ? undefined : editing} assetId={assetId} onClose={() => setEditing(null)} />}
    </div>
  );
}
export function AssetKnowledgeTab({ assetId }: { assetId: number }) {
  return <LinkedKnowledge assetId={assetId} />;
}
