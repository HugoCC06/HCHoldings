// Row shapes returned by the API.
import type {
  AssetCategory, AssetOrigin, AssetStatus, GoalMetric, GoalStatus, Level, MilestoneKind, NoteKind,
  OpportunityStage, Priority, ProjectStatus, TaskStatus, TxnCategory,
} from './domain';
import type { Assumptions } from './schemas';

interface Stamps { id: number; created_at: string; updated_at: string }

export interface Asset extends Stamps {
  name: string; logo: string | null; url: string | null; category: AssetCategory; status: AssetStatus;
  origin: AssetOrigin; start_date: string | null; acquisition_price: number | null;
  business_model: string | null; revenue_model: string | null; description: string | null;
  objectives: string | null; notes: string | null; risk_level: Level | null; key_risks: string | null;
  growth_potential: Level | null; weekly_hours: number | null; archived: boolean;
}
export interface Valuation extends Stamps { asset_id: number; date: string; value: number; method: string | null }
export interface Transaction extends Stamps {
  date: string; asset_id: number | null; category: TxnCategory; amount: number; description: string | null;
  counterparty: string | null; notes: string | null; source: 'manual' | 'import'; import_batch_id: number | null;
}
export interface CashAccount extends Stamps { name: string; institution: string | null; notes: string | null; archived: boolean }
export interface CashBalance extends Stamps { account_id: number; date: string; balance: number; notes: string | null }
export interface ImportBatch { id: number; filename: string; imported_at: string; row_count: number; skipped_count: number }
export interface Project extends Stamps {
  name: string; asset_id: number | null; description: string | null; status: ProjectStatus;
  start_date: string | null; target_date: string | null;
}
export interface Task extends Stamps {
  title: string; description: string | null; asset_id: number | null; project_id: number | null; priority: Priority;
  status: TaskStatus; deadline: string | null; notes: string | null; completed_at: string | null; sort_order: number;
}
export interface Milestone extends Stamps {
  title: string; asset_id: number | null; project_id: number | null; kind: MilestoneKind; description: string | null;
  target_date: string | null; completed_at: string | null;
}
export interface Opportunity extends Stamps {
  name: string; website: string | null; category: AssetCategory; stage: OpportunityStage; source: string | null;
  asking_price: number | null; estimated_value: number | null; max_price: number | null; target_return_pct: number | null;
  business_model: string | null; audience: string | null; growth_opportunities: string | null; risks: string | null;
  dd_notes: string | null; rejected_reason: string | null; assumptions: Assumptions | null; converted_asset_id: number | null;
}
export interface OppFinancial extends Stamps {
  opportunity_id: number; period: string; revenue: number; profit: number; traffic: number | null; verified: boolean; notes: string | null;
}
export interface Goal extends Stamps {
  asset_id: number; title: string; metric: GoalMetric; metric_name: string | null; target_value: number;
  manual_actual: number | null; target_date: string | null; status: GoalStatus; notes: string | null;
}
export interface Metric extends Stamps { asset_id: number; date: string; name: string; value: number; notes: string | null }
export interface Review extends Stamps {
  month: string; asset_id: number | null; improved: string | null; underperformed: string | null; learned: string | null;
  fix: string | null; stop: string | null; priorities: string | null;
}
export interface Note extends Stamps {
  title: string; body: string | null; kind: NoteKind; url: string | null; tags: string | null;
  asset_id: number | null; project_id: number | null; opportunity_id: number | null; pinned: boolean;
}
export interface DocumentMeta extends Stamps {
  filename: string; mime: string; size: number; description: string | null;
  asset_id: number | null; project_id: number | null; opportunity_id: number | null; note_id: number | null;
}
