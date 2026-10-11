import { QueryClient, useMutation, useQuery } from '@tanstack/react-query';
import type {
  Asset, CashAccount, CashBalance, DocumentMeta, Goal, Metric, Milestone, Note, OppFinancial, Opportunity, Project, Review,
  Task, Transaction, Valuation,
} from '../../shared/types';
import type { Settings } from '../../shared/schemas';
import type { TxnLite } from '../../shared/finance';
import { localRequest } from '../local/client';

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string[]>) {
    super(message);
  }
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

/** All data lives in this browser; requests are served by the local data engine. */
export async function api<T>(url: string, init: { method?: string; json?: unknown; body?: unknown } = {}): Promise<T> {
  const res = await localRequest(init.method ?? 'GET', url, init.json !== undefined ? init.json : init.body);
  if (res.status >= 400) {
    const b = (res.body ?? {}) as { error?: string; fields?: Record<string, string[]> };
    throw new ApiError(res.status, b.error ?? `Request failed (${res.status})`, b.fields);
  }
  return res.body as T;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Fetch a file-producing route (backup, exports, documents) and save or open it. */
export async function downloadFile(url: string, mode: 'save' | 'open' = 'save') {
  const res = await localRequest('GET', url);
  if (res.status >= 400 || !res.blob) throw new ApiError(res.status, (res.body as { error?: string })?.error ?? 'Download failed');
  if (mode === 'open') {
    const obj = URL.createObjectURL(res.blob);
    const w = window.open(obj, '_blank', 'noopener');
    if (!w) saveBlob(res.blob, res.filename ?? 'file');
    setTimeout(() => URL.revokeObjectURL(obj), 60_000);
  } else saveBlob(res.blob, res.filename ?? 'download');
}

export interface Snapshot {
  settings: Settings;
  meta: { lastBackupAt?: string | null };
  assets: Asset[];
  valuations: Valuation[];
  transactions: (TxnLite & { id: number })[];
  cashAccounts: CashAccount[];
  cashBalances: CashBalance[];
  projects: Project[];
  tasks: Task[];
  milestones: Milestone[];
  opportunities: Opportunity[];
  goals: Goal[];
  metrics: Metric[];
}

export function useSnapshot() {
  return useQuery({ queryKey: ['snapshot'], queryFn: () => api<Snapshot>('/api/snapshot') });
}

export interface ResourceTypes {
  assets: Asset; valuations: Valuation; transactions: Transaction; 'cash-accounts': CashAccount; 'cash-balances': CashBalance;
  projects: Project; tasks: Task; milestones: Milestone; opportunities: Opportunity; 'opp-financials': OppFinancial;
  goals: Goal; metrics: Metric; reviews: Review; notes: Note; documents: DocumentMeta;
}
export type ResourceName = keyof ResourceTypes;

function qs(params?: Record<string, string | number | null | undefined>) {
  if (!params) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, v === null ? 'null' : String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function useList<R extends ResourceName>(resource: R, params?: Record<string, string | number | null | undefined>, enabled = true) {
  return useQuery({
    queryKey: [resource, params ?? {}],
    queryFn: () => api<ResourceTypes[R][]>(`/api/${resource}${qs(params)}`),
    enabled,
  });
}

export function useOne<R extends ResourceName>(resource: R, id: number | undefined) {
  return useQuery({
    queryKey: [resource, 'one', id],
    queryFn: () => api<ResourceTypes[R]>(`/api/${resource}/${id}`),
    enabled: !!id,
  });
}

/** Any write invalidates everything: data volumes are small and correctness matters more than cache finesse. */
export const invalidateAll = () => queryClient.invalidateQueries();

export function useSave<R extends ResourceName>(resource: R) {
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: Record<string, unknown> }) =>
      api<ResourceTypes[R]>(id ? `/api/${resource}/${id}` : `/api/${resource}`, { method: id ? 'PUT' : 'POST', json: data }),
    onSuccess: invalidateAll,
  });
}

export function usePatch<R extends ResourceName>(resource: R) {
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      api<ResourceTypes[R]>(`/api/${resource}/${id}`, { method: 'PATCH', json: data }),
    onSuccess: invalidateAll,
  });
}

export function useRemove(resource: ResourceName) {
  return useMutation({
    mutationFn: ({ id, query }: { id: number; query?: string }) => api<void>(`/api/${resource}/${id}${query ?? ''}`, { method: 'DELETE' }),
    onSuccess: invalidateAll,
  });
}

export async function uploadDocument(file: File, links: Record<string, number | null | undefined>, description?: string) {
  const params = qs({ filename: file.name, description, ...links });
  return api<DocumentMeta>(`/api/documents${params}`, { method: 'POST', body: file });
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
