// Fixed vocabularies used by both the server (validation) and the UI (labels).

export const ASSET_CATEGORIES = {
  saas: 'SaaS & software',
  website: 'Websites & online businesses',
  media: 'Finance media & newsletters',
  game: 'Video games',
  mobile: 'Mobile applications',
  digital_product: 'Digital products',
  ecommerce: 'E-commerce',
  other: 'Other digital assets',
} as const;
export type AssetCategory = keyof typeof ASSET_CATEGORIES;

/**
 * Lifecycle stage. Distinguishes what is owned and operating from what is being
 * built and from ideas still under consideration.
 */
export const ASSET_STATUSES = {
  idea: 'Idea',
  development: 'In development',
  operating: 'Operating',
  paused: 'Paused',
  sold: 'Sold / closed',
} as const;
export type AssetStatus = keyof typeof ASSET_STATUSES;

export const ASSET_ORIGINS = { built: 'Built', acquired: 'Acquired' } as const;
export type AssetOrigin = keyof typeof ASSET_ORIGINS;

export const LEVELS = { low: 'Low', medium: 'Medium', high: 'High' } as const;
export type Level = keyof typeof LEVELS;

/**
 * Transaction categories. Each belongs to exactly one class, and the class
 * decides how it is treated in every calculation:
 *  - revenue: operating income
 *  - opex:    operating expenses (reduce operating profit)
 *  - capital: capital deployed into assets (counts towards invested capital, never profit)
 *  - owner:   money moving between you and the holding company (cash only, never profit or invested capital)
 */
export const TXN_CATEGORIES = {
  revenue: { label: 'Revenue', class: 'revenue' },
  hosting: { label: 'Hosting & infrastructure', class: 'opex' },
  software: { label: 'Software subscriptions', class: 'opex' },
  marketing: { label: 'Marketing', class: 'opex' },
  development: { label: 'Development', class: 'opex' },
  payment_fees: { label: 'Payment processing fees', class: 'opex' },
  other_opex: { label: 'Other operating costs', class: 'opex' },
  investment: { label: 'One-off investment', class: 'capital' },
  acquisition_cost: { label: 'Acquisition costs', class: 'capital' },
  owner_contribution: { label: 'Owner capital contribution', class: 'owner' },
  owner_distribution: { label: 'Owner distribution', class: 'owner' },
} as const;
export type TxnCategory = keyof typeof TXN_CATEGORIES;
export type TxnClass = (typeof TXN_CATEGORIES)[TxnCategory]['class'];
export const OPEX_CATEGORIES = (Object.keys(TXN_CATEGORIES) as TxnCategory[]).filter(
  (c) => TXN_CATEGORIES[c].class === 'opex',
);

export const PROJECT_STATUSES = {
  planned: 'Planned',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
} as const;
export type ProjectStatus = keyof typeof PROJECT_STATUSES;

export const TASK_STATUSES = {
  backlog: 'Backlog',
  next: 'Next',
  in_progress: 'In progress',
  waiting: 'Waiting',
  completed: 'Completed',
} as const;
export type TaskStatus = keyof typeof TASK_STATUSES;

export const PRIORITIES = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' } as const;
export type Priority = keyof typeof PRIORITIES;
export const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const MILESTONE_KINDS = {
  launch: 'Launch',
  release: 'Product release',
  revenue: 'Revenue target',
  audience: 'Audience target',
  other: 'Other',
} as const;
export type MilestoneKind = keyof typeof MILESTONE_KINDS;

export const OPPORTUNITY_STAGES = {
  idea: 'Idea',
  researching: 'Researching',
  review: 'Under review',
  due_diligence: 'Due diligence',
  offer: 'Considering an offer',
  acquired: 'Acquired',
  rejected: 'Rejected',
} as const;
export type OpportunityStage = keyof typeof OPPORTUNITY_STAGES;
export const OPEN_STAGES: OpportunityStage[] = ['idea', 'researching', 'review', 'due_diligence', 'offer'];

export const GOAL_METRICS = {
  monthly_revenue: 'Monthly revenue',
  monthly_profit: 'Monthly operating profit',
  metric: 'Tracked metric (audience, customers…)',
  custom: 'Custom (manual progress)',
} as const;
export type GoalMetric = keyof typeof GOAL_METRICS;

export const GOAL_STATUSES = { active: 'Active', achieved: 'Achieved', missed: 'Missed', dropped: 'Dropped' } as const;
export type GoalStatus = keyof typeof GOAL_STATUSES;

export const NOTE_KINDS = {
  idea: 'Business idea',
  thesis: 'Investment thesis',
  research: 'Research note',
  acquisition: 'Acquisition analysis',
  decision: 'Strategic decision',
  roadmap: 'Product roadmap',
  link: 'Important link',
  lesson: 'Lesson learned',
  other: 'Other',
} as const;
export type NoteKind = keyof typeof NOTE_KINDS;

export const CURRENCIES = ['GBP', 'USD', 'EUR', 'CAD', 'AUD', 'CHF', 'SEK', 'NOK', 'DKK', 'JPY'] as const;

export function keysOf<T extends object>(o: T): [keyof T & string, ...(keyof T & string)[]] {
  return Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
}
