// The app's "backend", running entirely inside the browser. It exposes the same
// REST-style routes the UI was built against, validates every write with the shared
// schemas, enforces relationships between records, and persists to IndexedDB.
import { z, type ZodTypeAny } from 'zod';
import {
  assetSchema, cashAccountSchema, cashBalanceSchema, documentMetaSchema, goalSchema, metricSchema, milestoneSchema,
  noteSchema, oppFinancialSchema, opportunitySchema, projectSchema, reviewSchema, settingsSchema, taskSchema,
  transactionSchema, valuationSchema,
} from '../../shared/schemas';
import { TXN_CATEGORIES } from '../../shared/domain';
import { TXN_CSV_HEADER, toCsv, txnFingerprint, validateTxnCsv } from '../../shared/csv';
import { minorToInput } from '../../shared/money';
import { todayISO } from '../../shared/dates';
import type { Persistence, Row, Snapshot, State } from './persistence';

export const APP_ID = 'hc-holdings-os';
export const DATA_VERSION = 1;
const DEFAULT_SETTINGS = { company_name: 'Holding Company', currency: 'GBP', fiscal_year_start: 1 };
const KEEP_SNAPSHOTS = 14;

export class HttpError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string[] | undefined>) {
    super(message);
  }
}

export interface Response { status: number; body?: unknown; blob?: Blob; filename?: string }

type Cmp = (a: Row, b: Row) => number;
const by = (...fns: ((r: Row) => string | number | null | boolean)[]): Cmp => (a, b) => {
  for (const f of fns) {
    const x = f(a);
    const y = f(b);
    if (x === y) continue;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === 'string' && typeof y === 'string') return x.localeCompare(y, undefined, { sensitivity: 'base' });
    return x < y ? -1 : 1;
  }
  return 0;
};
const descStr = (key: string): Cmp => (a, b) => String(b[key] ?? '').localeCompare(String(a[key] ?? ''));
const chain = (...cmps: Cmp[]): Cmp => (a, b) => {
  for (const c of cmps) {
    const r = c(a, b);
    if (r) return r;
  }
  return 0;
};

interface Resource {
  table: string;
  schema: z.ZodObject<Record<string, ZodTypeAny>>;
  order: Cmp;
  filters?: string[];
  /** Foreign keys: column -> table that must contain the id */
  refs?: Record<string, string>;
  /** Extra columns set on insert */
  defaults?: Record<string, unknown>;
  prepare?: (data: Row, existing: Row | null) => Row;
  hidden?: string[];
}

const byDateDesc = chain(descStr('date'), (a, b) => b.id - a.id);

const RESOURCES: Record<string, Resource> = {
  assets: { table: 'assets', schema: assetSchema, order: by((r) => !!r.archived, (r) => r.name as string) },
  valuations: { table: 'valuations', schema: valuationSchema, filters: ['asset_id'], refs: { asset_id: 'assets' }, order: byDateDesc },
  transactions: {
    table: 'transactions', schema: transactionSchema, filters: ['asset_id', 'category'], refs: { asset_id: 'assets' }, order: byDateDesc,
    defaults: { source: 'manual', import_batch_id: null },
    prepare: (d) => ({ ...d, fingerprint: txnFingerprint({ date: d.date as string, amount: d.amount as number, category: d.category as string, asset_id: (d.asset_id as number | null) ?? null, description: (d.description as string | null) ?? null }) }),
  },
  'cash-accounts': { table: 'cash_accounts', schema: cashAccountSchema, order: by((r) => !!r.archived, (r) => r.name as string) },
  'cash-balances': { table: 'cash_balances', schema: cashBalanceSchema, filters: ['account_id'], refs: { account_id: 'cash_accounts' }, order: byDateDesc },
  projects: { table: 'projects', schema: projectSchema, filters: ['asset_id', 'status'], refs: { asset_id: 'assets' }, order: by((r) => r.name as string) },
  tasks: {
    table: 'tasks', schema: taskSchema, filters: ['asset_id', 'project_id', 'status'], refs: { asset_id: 'assets', project_id: 'projects' },
    order: by((r) => r.sort_order as number, (r) => r.id),
    prepare: (d) => {
      if (d.status === 'completed' && !d.completed_at) return { ...d, completed_at: todayISO() };
      if (d.status !== 'completed' && d.completed_at) return { ...d, completed_at: null };
      return d;
    },
  },
  milestones: { table: 'milestones', schema: milestoneSchema, filters: ['asset_id', 'project_id'], refs: { asset_id: 'assets', project_id: 'projects' }, order: by((r) => (r.target_date as string | null) ?? null, (r) => r.id) },
  opportunities: { table: 'opportunities', schema: opportunitySchema, filters: ['stage'], order: descStr('updated_at'), defaults: { converted_asset_id: null } },
  'opp-financials': { table: 'opp_financials', schema: oppFinancialSchema, filters: ['opportunity_id'], refs: { opportunity_id: 'opportunities' }, order: descStr('period') },
  goals: { table: 'goals', schema: goalSchema, filters: ['asset_id'], refs: { asset_id: 'assets' }, order: by((r) => (r.target_date as string | null) ?? null, (r) => r.id) },
  metrics: { table: 'metrics', schema: metricSchema, filters: ['asset_id'], refs: { asset_id: 'assets' }, order: byDateDesc },
  reviews: { table: 'reviews', schema: reviewSchema, filters: ['month', 'asset_id'], refs: { asset_id: 'assets' }, order: chain(descStr('month'), by((r) => (r.asset_id as number | null) ?? 0)) },
  notes: { table: 'notes', schema: noteSchema, filters: ['asset_id', 'project_id', 'opportunity_id', 'kind'], refs: { asset_id: 'assets', project_id: 'projects', opportunity_id: 'opportunities' }, order: chain(by((r) => !r.pinned), descStr('updated_at')) },
  documents: { table: 'documents', schema: documentMetaSchema, filters: ['asset_id', 'project_id', 'opportunity_id', 'note_id'], refs: { asset_id: 'assets', project_id: 'projects', opportunity_id: 'opportunities', note_id: 'notes' }, order: descStr('created_at') },
};

const TABLES = ['assets', 'valuations', 'transactions', 'import_batches', 'cash_accounts', 'cash_balances', 'projects', 'tasks', 'milestones', 'opportunities', 'opp_financials', 'goals', 'metrics', 'reviews', 'notes', 'documents'];

export function emptyState(): State {
  return { app_id: APP_ID, version: DATA_VERSION, nextId: {}, settings: {}, meta: { lastBackupAt: null }, tables: Object.fromEntries(TABLES.map((t) => [t, []])) };
}

/** Check that an object looks like this app's data before accepting it. */
export function validateState(s: unknown): string | null {
  const st = s as State;
  if (!st || typeof st !== 'object' || st.app_id !== APP_ID || typeof st.tables !== 'object') return 'This file is not a Holding Company OS backup.';
  if (typeof st.version !== 'number' || st.version > DATA_VERSION) return 'This backup was made by a newer version of the app.';
  for (const t of TABLES) if (st.tables[t] !== undefined && !Array.isArray(st.tables[t])) return `Backup is damaged (table ${t}).`;
  return null;
}

export function validate<T extends ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(422, 'Please correct the highlighted fields.', r.error.flatten().fieldErrors as Record<string, string[]>);
  return r.data;
}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id');
  return id;
}

const now = () => new Date().toISOString();
const clone = <T>(v: T): T => structuredClone(v);

async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export class LocalServer {
  private state: State = emptyState();
  private ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private persistence: Persistence, opts: { autoSnapshot?: boolean } = {}) {
    this.ready = (async () => {
      const loaded = await persistence.load();
      if (loaded) {
        const problem = validateState(loaded);
        if (problem) throw new Error(`Stored data could not be read: ${problem}`);
        this.state = { ...emptyState(), ...loaded, tables: { ...emptyState().tables, ...loaded.tables } };
      }
      if (opts.autoSnapshot) await this.dailySnapshot();
    })();
  }

  // ------------------------------------------------------------ plumbing
  private rows(table: string): Row[] {
    return (this.state.tables[table] ??= []);
  }
  private find(table: string, id: number): Row | undefined {
    return this.rows(table).find((r) => r.id === id);
  }
  private nextId(table: string): number {
    const max = this.rows(table).reduce((m, r) => Math.max(m, r.id), 0);
    const n = Math.max(this.state.nextId[table] ?? 1, max + 1);
    this.state.nextId[table] = n + 1;
    return n;
  }
  private async commit() {
    await this.persistence.save(this.state);
  }

  /** Serialise all requests so writes never interleave. */
  request(method: string, url: string, body?: unknown): Promise<Response> {
    const run = async () => {
      await this.ready;
      const write = method.toUpperCase() !== 'GET';
      const before = this.state;
      if (write) this.state = clone(this.state); // work on a copy so a failed request changes nothing
      try {
        const res = await this.route(method.toUpperCase(), url, body);
        if (write) await this.commit();
        return res;
      } catch (e) {
        this.state = before;
        if (e instanceof HttpError) return { status: e.status, body: { error: e.message, fields: e.fields } };
        console.error(e);
        return { status: 500, body: { error: `Unexpected error: ${(e as Error).message}. Your data has not been changed.` } };
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  // ------------------------------------------------------------ router
  private async route(method: string, url: string, body: unknown): Promise<Response> {
    const u = new URL(url, 'http://local');
    const parts = u.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const q = u.searchParams;
    const [head, second, third] = parts;

    if (head === 'snapshot' && method === 'GET') return this.ok(this.snapshot());
    if (head === 'settings') {
      if (method === 'GET') return this.ok(this.readSettings());
      if (method === 'PUT') {
        Object.assign(this.state.settings, validate(settingsSchema, body));
        return this.ok(this.readSettings());
      }
    }
    if (head === 'search' && method === 'GET') return this.ok(this.search(q.get('q') ?? ''));
    if (head === 'transactions' && second === 'export.csv') return this.exportCsv(q);
    if (head === 'transactions' && second === 'import' && method === 'POST') return this.ok(this.importCsv(third === 'commit', body));
    if (head === 'transactions' && second === 'bulk-delete' && method === 'POST') {
      const { ids } = validate(z.object({ ids: z.array(z.number().int().positive()).min(1).max(100_000) }), body);
      const set = new Set(ids);
      const before = this.rows('transactions').length;
      this.state.tables.transactions = this.rows('transactions').filter((t) => !set.has(t.id));
      return this.ok({ removed: before - this.rows('transactions').length });
    }
    if (head === 'import-batches') {
      if (method === 'GET' && !second) return this.ok(clone(this.rows('import_batches')).sort((a, b) => b.id - a.id));
      if (method === 'DELETE' && second) {
        const id = parseId(second);
        const before = this.rows('transactions').length;
        this.state.tables.transactions = this.rows('transactions').filter((t) => t.import_batch_id !== id);
        this.state.tables.import_batches = this.rows('import_batches').filter((b) => b.id !== id);
        return this.ok({ removed: before - this.rows('transactions').length });
      }
    }
    if (head === 'opportunities' && third === 'convert' && method === 'POST') return this.ok(this.convert(parseId(second), body));
    if (head === 'documents' && !second && method === 'POST') return this.upload(q, body);
    if (head === 'documents' && third === 'file' && method === 'GET') return this.file(parseId(second));
    if (head === 'backup' && method === 'GET') return this.backupFile();
    if (head === 'backups') {
      if (method === 'GET' && !second) return this.ok(await this.persistence.listSnapshots());
      if (method === 'POST' && !second) return this.ok(await this.takeSnapshot('manual'), 201);
      if (method === 'POST' && third === 'restore') return this.ok(await this.restoreSnapshot(decodeURIComponent(second)));
    }
    if (head === 'restore' && method === 'POST') return this.ok(await this.restore(body));
    if (head === 'export.json' && method === 'GET') return this.exportJson();

    const res = RESOURCES[head];
    if (res) return this.resource(res, method, second, q, body);
    throw new HttpError(404, 'Unknown endpoint');
  }

  private ok(body: unknown, status = 200): Response {
    return { status, body };
  }

  // ------------------------------------------------------------ generic CRUD
  private resource(def: Resource, method: string, idPart: string | undefined, q: URLSearchParams, body: unknown): Response {
    const strip = (r: Row) => {
      const o = clone(r);
      for (const h of def.hidden ?? []) delete o[h];
      return o;
    };
    if (method === 'GET' && !idPart) {
      let list = this.rows(def.table);
      for (const f of def.filters ?? []) {
        const v = q.get(f);
        if (v === null) continue;
        list = list.filter((r) => (v === 'null' ? r[f] === null || r[f] === undefined : String(r[f]) === v));
      }
      return this.ok([...list].sort(def.order).map(strip));
    }
    if (!idPart) {
      if (method !== 'POST') throw new HttpError(405, 'Method not allowed');
      const data = validate(def.schema, body) as Row;
      const row = this.insert(def, data);
      return this.ok(strip(row), 201);
    }
    const id = parseId(idPart);
    const existing = this.find(def.table, id);
    if (!existing) throw new HttpError(404, 'Not found');
    if (method === 'GET') return this.ok(strip(existing));
    if (method === 'PUT' || method === 'PATCH') {
      const input = method === 'PATCH' ? { ...existing, ...((body as object) ?? {}) } : body;
      const data = validate(def.schema, input) as Row;
      return this.ok(strip(this.update(def, existing, data)));
    }
    if (method === 'DELETE') {
      this.remove(def.table, id, q);
      return { status: 204 };
    }
    throw new HttpError(405, 'Method not allowed');
  }

  private checkRefs(def: Resource, data: Row) {
    for (const [col, table] of Object.entries(def.refs ?? {})) {
      const v = data[col];
      if (v !== null && v !== undefined && !this.find(table, v as number)) throw new HttpError(422, `The linked ${table.replace(/_/g, ' ').replace(/s$/, '')} no longer exists.`, { [col]: ['Not found'] });
    }
  }

  private checkUnique(def: Resource, data: Row, selfId: number | null) {
    if (def.table === 'reviews') {
      const dup = this.rows('reviews').find((r) => r.id !== selfId && r.month === data.month && (r.asset_id ?? null) === (data.asset_id ?? null));
      if (dup) throw new HttpError(409, 'A review for this month and scope already exists.');
    }
    if (def.table === 'opp_financials') {
      const dup = this.rows('opp_financials').find((r) => r.id !== selfId && r.opportunity_id === data.opportunity_id && r.period === data.period);
      if (dup) throw new HttpError(409, 'Figures for this month already exist. Edit that month instead.');
    }
  }

  private insert(def: Resource, data: Row): Row {
    let d = { ...(def.defaults ?? {}), ...data } as Row;
    if (def.prepare) d = def.prepare(d, null);
    this.checkRefs(def, d);
    this.checkUnique(def, d, null);
    const t = now();
    const row = { ...d, id: this.nextId(def.table), created_at: t, updated_at: t } as Row;
    this.rows(def.table).push(row);
    return row;
  }

  private update(def: Resource, existing: Row, data: Row): Row {
    let d = data;
    if (def.prepare) d = def.prepare(d, existing);
    this.checkRefs(def, d);
    this.checkUnique(def, d, existing.id);
    const row = { ...existing, ...d, id: existing.id, updated_at: now() } as Row;
    const list = this.rows(def.table);
    list[list.indexOf(existing)] = row;
    return row;
  }

  /** Delete with the same relationship rules a relational database would enforce. */
  private remove(table: string, id: number, q: URLSearchParams) {
    const T = this.state.tables;
    const unlink = (t: string, col: string) => {
      T[t] = this.rows(t).map((r) => (r[col] === id ? { ...r, [col]: null } : r));
    };
    const cascade = (t: string, col: string) => {
      T[t] = this.rows(t).filter((r) => r[col] !== id);
    };
    switch (table) {
      case 'assets': {
        const n = this.rows('transactions').filter((t) => t.asset_id === id).length;
        if (n && q.get('withTransactions') !== '1')
          throw new HttpError(409, `This asset has ${n} financial transaction${n > 1 ? 's' : ''}. Archive it instead, or confirm deleting its transactions too.`);
        cascade('transactions', 'asset_id');
        for (const t of ['valuations', 'goals', 'metrics', 'reviews']) cascade(t, 'asset_id');
        for (const t of ['projects', 'tasks', 'milestones', 'notes', 'documents']) unlink(t, 'asset_id');
        unlink('opportunities', 'converted_asset_id');
        break;
      }
      case 'projects':
        for (const t of ['tasks', 'milestones', 'notes', 'documents']) unlink(t, 'project_id');
        break;
      case 'opportunities':
        cascade('opp_financials', 'opportunity_id');
        for (const t of ['notes', 'documents']) unlink(t, 'opportunity_id');
        break;
      case 'notes':
        unlink('documents', 'note_id');
        break;
      case 'cash_accounts':
        cascade('cash_balances', 'account_id');
        break;
      case 'documents':
        void this.persistence.deleteFile(id);
        break;
    }
    T[table] = this.rows(table).filter((r) => r.id !== id);
  }

  // ------------------------------------------------------------ specific routes
  private readSettings() {
    return { ...DEFAULT_SETTINGS, ...this.state.settings };
  }

  private snapshot() {
    const T = this.state.tables;
    const sorted = (t: string, cmp: Cmp) => clone([...(T[t] ?? [])]).sort(cmp);
    const asc = by((r) => r.date as string, (r) => r.id);
    return {
      settings: this.readSettings(),
      meta: clone(this.state.meta),
      assets: sorted('assets', RESOURCES.assets.order),
      valuations: sorted('valuations', asc),
      transactions: sorted('transactions', asc).map((t) => ({ id: t.id, date: t.date, asset_id: t.asset_id, category: t.category, amount: t.amount })),
      cashAccounts: clone(T.cash_accounts ?? []),
      cashBalances: sorted('cash_balances', asc),
      projects: clone(T.projects ?? []),
      tasks: sorted('tasks', RESOURCES.tasks.order),
      milestones: sorted('milestones', RESOURCES.milestones.order),
      opportunities: sorted('opportunities', RESOURCES.opportunities.order),
      goals: clone(T.goals ?? []),
      metrics: sorted('metrics', asc),
    };
  }

  private search(raw: string) {
    const q = raw.trim().toLowerCase();
    if (q.length < 2) return [];
    const hit = (...v: unknown[]) => v.some((x) => typeof x === 'string' && x.toLowerCase().includes(q));
    const T = this.state.tables;
    const take = (type: string, t: string, title: string, snippet: string, fields: string[]) =>
      (T[t] ?? []).filter((r) => hit(...fields.map((f) => r[f]))).slice(0, 10).map((r) => ({ type, id: r.id, title: r[title], snippet: typeof r[snippet] === 'string' ? (r[snippet] as string).slice(0, 160) : null }));
    return [
      ...take('asset', 'assets', 'name', 'description', ['name', 'description', 'notes']),
      ...take('opportunity', 'opportunities', 'name', 'business_model', ['name', 'dd_notes', 'risks']),
      ...take('note', 'notes', 'title', 'body', ['title', 'body', 'tags']),
      ...take('task', 'tasks', 'title', 'description', ['title', 'description', 'notes']),
      ...take('project', 'projects', 'name', 'description', ['name', 'description']),
      ...take('document', 'documents', 'filename', 'description', ['filename', 'description']),
    ];
  }

  private exportCsv(q: URLSearchParams): Response {
    const assets = new Map(this.rows('assets').map((a) => [a.id, a.name as string]));
    let rows = [...this.rows('transactions')].sort(by((r) => r.date as string, (r) => r.id));
    const a = q.get('asset_id');
    if (a) rows = rows.filter((r) => (a === 'null' ? r.asset_id === null : r.asset_id === Number(a)));
    const csv = toCsv(TXN_CSV_HEADER, rows.map((r) => [r.date, r.asset_id ? assets.get(r.asset_id as number) : 'Holding company', r.category, minorToInput(r.amount as number), r.description, r.counterparty, r.notes]));
    return { status: 200, blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename: `transactions-${todayISO()}.csv` };
  }

  private importCsv(commit: boolean, body: unknown) {
    const schema = z.object({ csv: z.string().max(20_000_000), filename: z.string().max(255).default('import.csv'), includeDuplicates: z.array(z.number().int()).default([]) });
    const b = validate(schema, body);
    const assets = this.rows('assets').map((r) => ({ id: r.id, name: r.name as string }));
    const existing = new Set(this.rows('transactions').map((t) => t.fingerprint as string));
    const result = validateTxnCsv(b.csv, assets, existing);
    if (!commit) return result;
    if (result.headerErrors.length) throw new HttpError(422, result.headerErrors.join(' '));
    const include = new Set(b.includeDuplicates);
    const valid = result.rows.filter((r) => !r.errors.length && (!r.duplicate || include.has(r.line)));
    const batchId = this.nextId('import_batches');
    this.rows('import_batches').push({ id: batchId, filename: b.filename, imported_at: now(), row_count: valid.length, skipped_count: result.rows.length - valid.length });
    const t = now();
    for (const r of valid) {
      this.rows('transactions').push({
        id: this.nextId('transactions'), date: r.date, asset_id: r.asset_id, category: r.category, amount: r.amount, description: r.description,
        counterparty: r.counterparty, notes: r.notes, source: 'import', import_batch_id: batchId, fingerprint: r.fingerprint, created_at: t, updated_at: t,
      });
    }
    return { batchId, imported: valid.length, skipped: result.rows.length - valid.length };
  }

  private convert(id: number, body: unknown) {
    const b = validate(z.object({ price: z.number().int().min(0).nullable(), date: z.string() }), body);
    const opp = this.find('opportunities', id);
    if (!opp) throw new HttpError(404, 'Not found');
    if (opp.converted_asset_id) throw new HttpError(409, 'This opportunity has already been converted to an asset.');
    const asset = validate(assetSchema, {
      name: opp.name, url: opp.website, category: opp.category, status: 'operating', origin: 'acquired', start_date: b.date,
      acquisition_price: b.price, business_model: opp.business_model, key_risks: opp.risks, description: 'Acquired via pipeline.', notes: opp.dd_notes,
    }) as unknown as Row;
    const row = this.insert(RESOURCES.assets, asset);
    if (b.price) this.insert(RESOURCES.valuations, { asset_id: row.id, date: b.date, value: b.price, method: 'Purchase price' } as unknown as Row);
    this.update(RESOURCES.opportunities, opp, { ...opp, stage: 'acquired', converted_asset_id: row.id });
    const T = this.state.tables;
    for (const t of ['notes', 'documents']) T[t] = this.rows(t).map((r) => (r.opportunity_id === id && !r.asset_id ? { ...r, asset_id: row.id } : r));
    return { assetId: row.id };
  }

  private async upload(q: URLSearchParams, body: unknown): Promise<Response> {
    if (!(body instanceof Blob) || !body.size) throw new HttpError(400, 'Empty file');
    if (body.size > 50 * 1024 * 1024) throw new HttpError(413, 'File is too large (max 50 MB).');
    const num = (k: string) => (q.get(k) && /^\d+$/.test(q.get(k)!) ? Number(q.get(k)) : null);
    const meta = validate(documentMetaSchema, {
      filename: (q.get('filename') ?? '').replace(/[\\/]/g, '_'), description: q.get('description'),
      asset_id: num('asset_id'), project_id: num('project_id'), opportunity_id: num('opportunity_id'), note_id: num('note_id'),
    }) as unknown as Row;
    const row = this.insert(RESOURCES.documents, { ...meta, mime: body.type || 'application/octet-stream', size: body.size } as Row);
    await this.persistence.putFile(row.id, body);
    return this.ok(clone(row), 201);
  }

  private async file(id: number): Promise<Response> {
    const doc = this.find('documents', id);
    if (!doc) throw new HttpError(404, 'Not found');
    const blob = await this.persistence.getFile(id);
    if (!blob) throw new HttpError(404, 'The file content is missing (it may have been removed after this record was restored).');
    return { status: 200, blob: new Blob([blob], { type: doc.mime as string }), filename: doc.filename as string };
  }

  // ------------------------------------------------------------ backup & restore
  /** A full backup: every record plus every document, in one JSON file. */
  private async backupFile(): Promise<Response> {
    const files: Record<string, string> = {};
    for (const d of this.rows('documents')) {
      const b = await this.persistence.getFile(d.id);
      if (b) files[d.id] = await blobToBase64(b);
    }
    this.state.meta.lastBackupAt = now();
    const json = JSON.stringify({ ...this.state, exported_at: now(), files });
    await this.commit();
    return { status: 200, blob: new Blob([json], { type: 'application/json' }), filename: `holding-company-backup-${todayISO()}.json` };
  }

  private async restore(body: unknown) {
    let parsed: State & { files?: Record<string, string> };
    try {
      const text = body instanceof Blob ? await body.text() : String(body);
      parsed = JSON.parse(text);
    } catch {
      throw new HttpError(422, 'That file is not a valid backup (could not read JSON).');
    }
    const problem = validateState(parsed);
    if (problem) throw new HttpError(422, problem);
    await this.takeSnapshot('before restore');
    const { files = {}, ...state } = parsed;
    delete (state as Record<string, unknown>).exported_at;
    this.state = { ...emptyState(), ...state, tables: { ...emptyState().tables, ...state.tables } };
    for (const id of await this.persistence.listFileIds()) if (!files[id]) await this.persistence.deleteFile(id);
    for (const d of this.rows('documents')) if (files[d.id]) await this.persistence.putFile(d.id, base64ToBlob(files[d.id], d.mime as string));
    return { ok: true };
  }

  private async takeSnapshot(reason: string): Promise<{ key: string }> {
    const created = now();
    const key = `${created}-${reason}`;
    await this.persistence.putSnapshot({ key, created, reason, state: clone(this.state) } as Snapshot);
    const all = await this.persistence.listSnapshots();
    for (const s of all.slice(KEEP_SNAPSHOTS)) await this.persistence.deleteSnapshot(s.key);
    return { key };
  }

  private async restoreSnapshot(key: string) {
    const snap = await this.persistence.getSnapshot(key);
    if (!snap) throw new HttpError(404, 'Restore point not found');
    await this.takeSnapshot('before restore');
    this.state = clone(snap.state);
    return { ok: true };
  }

  /** Keeps one automatic restore point per day inside the browser. */
  private async dailySnapshot() {
    const hasData = TABLES.some((t) => (this.state.tables[t] ?? []).length);
    if (!hasData) return;
    const today = todayISO();
    const list = await this.persistence.listSnapshots();
    if (list.some((s) => s.reason === 'daily' && s.created.slice(0, 10) === today)) return;
    await this.takeSnapshot('daily');
  }

  private exportJson(): Response {
    const out = { exported_at: now(), categories: TXN_CATEGORIES, settings: this.readSettings(), ...clone(this.state.tables) };
    return { status: 200, blob: new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), filename: `holding-company-export-${todayISO()}.json` };
  }
}
