// Validation schemas for every record type. Used by the API (authoritative) and the UI forms.
import { z } from 'zod';
import {
  ASSET_CATEGORIES, ASSET_ORIGINS, ASSET_STATUSES, GOAL_METRICS, GOAL_STATUSES, LEVELS, MILESTONE_KINDS,
  NOTE_KINDS, OPPORTUNITY_STAGES, PRIORITIES, PROJECT_STATUSES, TASK_STATUSES, TXN_CATEGORIES, keysOf,
} from './domain';
import { isValidISODate } from './dates';

const text = (max = 20_000) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const requiredText = (max = 200) => z.string().trim().min(1, 'Required').max(max);
const isoDate = z.string().refine(isValidISODate, 'Use a valid date (YYYY-MM-DD)');
const optDate = isoDate.nullish().transform((v) => v ?? null);
const minor = z.number().int('Must be a whole number of minor units').refine(Number.isSafeInteger);
const nonNegMinor = minor.refine((v) => v >= 0, 'Cannot be negative');
const optMinor = nonNegMinor.nullish().transform((v) => v ?? null);
const optId = z.number().int().positive().nullish().transform((v) => v ?? null);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const url = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https?:\/\/\S+$/i.test(v), 'Use a full URL starting with http:// or https://');

export const assetSchema = z.object({
  name: requiredText(),
  logo: z
    .string()
    .max(400_000, 'Logo too large (max ~300 KB)')
    .refine((v) => v.startsWith('data:image/'), 'Logo must be an image')
    .nullish()
    .transform((v) => v ?? null),
  url,
  category: z.enum(keysOf(ASSET_CATEGORIES)),
  status: z.enum(keysOf(ASSET_STATUSES)),
  origin: z.enum(keysOf(ASSET_ORIGINS)),
  start_date: optDate,
  acquisition_price: optMinor,
  business_model: text(2000),
  revenue_model: text(2000),
  description: text(5000),
  objectives: text(),
  notes: text(),
  risk_level: z.enum(keysOf(LEVELS)).nullish().transform((v) => v ?? null),
  key_risks: text(),
  growth_potential: z.enum(keysOf(LEVELS)).nullish().transform((v) => v ?? null),
  weekly_hours: z.number().min(0).max(168).nullish().transform((v) => v ?? null),
  archived: z.boolean().default(false),
});
export type AssetInput = z.input<typeof assetSchema>;

export const valuationSchema = z.object({
  asset_id: z.number().int().positive(),
  date: isoDate,
  value: nonNegMinor,
  method: text(500),
});

export const transactionSchema = z.object({
  date: isoDate,
  asset_id: optId,
  category: z.enum(keysOf(TXN_CATEGORIES)),
  amount: nonNegMinor.refine((v) => v > 0, 'Amount must be greater than zero'),
  description: text(500),
  counterparty: text(200),
  notes: text(5000),
});
export type TransactionInput = z.input<typeof transactionSchema>;

export const cashAccountSchema = z.object({
  name: requiredText(),
  institution: text(200),
  notes: text(2000),
  archived: z.boolean().default(false),
});

export const cashBalanceSchema = z.object({
  account_id: z.number().int().positive(),
  date: isoDate,
  balance: minor,
  notes: text(1000),
});

export const projectSchema = z.object({
  name: requiredText(),
  asset_id: optId,
  description: text(),
  status: z.enum(keysOf(PROJECT_STATUSES)),
  start_date: optDate,
  target_date: optDate,
});

export const taskSchema = z.object({
  title: requiredText(300),
  description: text(),
  asset_id: optId,
  project_id: optId,
  priority: z.enum(keysOf(PRIORITIES)),
  status: z.enum(keysOf(TASK_STATUSES)),
  deadline: optDate,
  notes: text(),
  completed_at: optDate,
  sort_order: z.number().default(0),
});

export const milestoneSchema = z.object({
  title: requiredText(300),
  asset_id: optId,
  project_id: optId,
  kind: z.enum(keysOf(MILESTONE_KINDS)),
  description: text(),
  target_date: optDate,
  completed_at: optDate,
});

export const scenarioSchema = z.object({
  multiple: z.number().min(0).max(100),
  growthPct: z.number().min(-100).max(1000),
  discountPct: z.number().min(0).max(100),
  years: z.number().int().min(1).max(15),
  exitMultiple: z.number().min(0).max(100),
});
export const assumptionsSchema = z.object({
  /** Annual profit (minor units) used as the valuation basis; null = derive from TTM history. */
  annualProfitOverride: z.number().int().nullable(),
  pessimistic: scenarioSchema,
  base: scenarioSchema,
  optimistic: scenarioSchema,
  notes: z.string().max(5000).default(''),
});
export type Assumptions = z.infer<typeof assumptionsSchema>;

export const opportunitySchema = z.object({
  name: requiredText(),
  website: url,
  category: z.enum(keysOf(ASSET_CATEGORIES)),
  stage: z.enum(keysOf(OPPORTUNITY_STAGES)),
  source: text(500),
  asking_price: optMinor,
  estimated_value: optMinor,
  max_price: optMinor,
  target_return_pct: z.number().min(0).max(1000).nullish().transform((v) => v ?? null),
  business_model: text(2000),
  audience: text(),
  growth_opportunities: text(),
  risks: text(),
  dd_notes: text(),
  rejected_reason: text(2000),
  assumptions: assumptionsSchema.nullish().transform((v) => v ?? null),
});

export const oppFinancialSchema = z.object({
  opportunity_id: z.number().int().positive(),
  period: month,
  revenue: minor,
  profit: minor,
  traffic: z.number().int().min(0).nullish().transform((v) => v ?? null),
  verified: z.boolean().default(false),
  notes: text(1000),
});

export const goalSchema = z.object({
  asset_id: z.number().int().positive(),
  title: requiredText(300),
  metric: z.enum(keysOf(GOAL_METRICS)),
  metric_name: text(100),
  target_value: z.number().finite(),
  manual_actual: z.number().finite().nullish().transform((v) => v ?? null),
  target_date: optDate,
  status: z.enum(keysOf(GOAL_STATUSES)),
  notes: text(2000),
});

export const metricSchema = z.object({
  asset_id: z.number().int().positive(),
  date: isoDate,
  name: requiredText(100),
  value: z.number().finite(),
  notes: text(1000),
});

export const reviewSchema = z.object({
  month,
  asset_id: optId,
  improved: text(),
  underperformed: text(),
  learned: text(),
  fix: text(),
  stop: text(),
  priorities: text(),
});

export const noteSchema = z.object({
  title: requiredText(300),
  body: text(200_000),
  kind: z.enum(keysOf(NOTE_KINDS)),
  url,
  tags: text(500),
  asset_id: optId,
  project_id: optId,
  opportunity_id: optId,
  pinned: z.boolean().default(false),
});

export const documentMetaSchema = z.object({
  filename: requiredText(255),
  description: text(2000),
  asset_id: optId,
  project_id: optId,
  opportunity_id: optId,
  note_id: optId,
});

export const settingsSchema = z.object({
  company_name: z.string().trim().min(1).max(120),
  currency: z.string().regex(/^[A-Z]{3}$/),
  fiscal_year_start: z.number().int().min(1).max(12),
});
export type Settings = z.infer<typeof settingsSchema>;
