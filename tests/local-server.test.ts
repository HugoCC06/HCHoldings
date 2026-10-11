import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { LocalServer } from '../src/local/server';
import { IndexedDbPersistence, MemoryPersistence } from '../src/local/persistence';

let p: MemoryPersistence;
let server: LocalServer;
const call = async (method: string, url: string, body?: unknown) => server.request(method, url, body);
const ok = async (method: string, url: string, body?: unknown) => {
  const r = await call(method, url, body);
  if (r.status >= 400) throw new Error(`${method} ${url} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

beforeEach(() => {
  p = new MemoryPersistence();
  server = new LocalServer(p);
});

const asset = { name: 'Acme SaaS', category: 'saas', status: 'operating', origin: 'acquired', acquisition_price: 1_000_000, start_date: '2026-01-01' };

describe('assets', () => {
  it('creates, reads, updates, archives and deletes — and persists every write', async () => {
    const created = await ok('POST', '/api/assets', asset);
    expect(created).toMatchObject({ id: 1, name: 'Acme SaaS', archived: false, acquisition_price: 1_000_000 });
    expect(p.state?.tables.assets).toHaveLength(1);
    await ok('PATCH', `/api/assets/${created.id}`, { archived: true });
    expect((await ok('GET', `/api/assets/${created.id}`)).archived).toBe(true);
    expect((await call('DELETE', `/api/assets/${created.id}`)).status).toBe(204);
    expect((await call('GET', `/api/assets/${created.id}`)).status).toBe(404);
    expect(p.state?.tables.assets).toHaveLength(0);
  });
  it('rejects invalid input with field errors and changes nothing', async () => {
    const r = await call('POST', '/api/assets', { ...asset, name: '', url: 'not a url', category: 'nope' });
    expect(r.status).toBe(422);
    expect(Object.keys((r.body as { fields: object }).fields)).toEqual(expect.arrayContaining(['name', 'url', 'category']));
    expect(p.state).toBeNull();
  });
  it('refuses to delete an asset with transactions unless confirmed, then cascades', async () => {
    const a = await ok('POST', '/api/assets', asset);
    await ok('POST', '/api/transactions', { date: '2026-02-01', asset_id: a.id, category: 'revenue', amount: 100 });
    await ok('POST', '/api/valuations', { asset_id: a.id, date: '2026-02-01', value: 5 });
    const task = await ok('POST', '/api/tasks', { title: 'x', priority: 'low', status: 'next', asset_id: a.id });
    const r = await call('DELETE', `/api/assets/${a.id}`);
    expect(r.status).toBe(409);
    expect((r.body as { error: string }).error).toMatch(/1 financial transaction/);
    await call('DELETE', `/api/assets/${a.id}?withTransactions=1`);
    expect(await ok('GET', '/api/transactions')).toHaveLength(0);
    expect(await ok('GET', '/api/valuations')).toHaveLength(0);
    expect((await ok('GET', `/api/tasks/${task.id}`)).asset_id).toBeNull();
  });
  it('never reuses ids after deletion', async () => {
    const a = await ok('POST', '/api/assets', asset);
    await call('DELETE', `/api/assets/${a.id}`);
    expect((await ok('POST', '/api/assets', asset)).id).toBe(2);
  });
});

describe('transactions', () => {
  it('validates amount and date', async () => {
    const r = await call('POST', '/api/transactions', { date: '2026-02-30', category: 'revenue', amount: 0 });
    expect(r.status).toBe(422);
    expect((r.body as { fields: object }).fields).toHaveProperty('date');
    expect((r.body as { fields: object }).fields).toHaveProperty('amount');
  });
  it('rejects a link to an asset that does not exist', async () => {
    expect((await call('POST', '/api/transactions', { date: '2026-02-01', asset_id: 99, category: 'revenue', amount: 1 })).status).toBe(422);
  });
  it('filters by asset including holding-company (null)', async () => {
    const a = await ok('POST', '/api/assets', asset);
    await ok('POST', '/api/transactions', { date: '2026-02-01', asset_id: a.id, category: 'revenue', amount: 1 });
    await ok('POST', '/api/transactions', { date: '2026-02-02', category: 'software', amount: 2 });
    expect(await ok('GET', `/api/transactions?asset_id=${a.id}`)).toHaveLength(1);
    expect((await ok('GET', '/api/transactions?asset_id=null'))[0].amount).toBe(2);
  });
  it('imports CSV with duplicate protection and can undo a batch', async () => {
    await ok('POST', '/api/assets', asset);
    const csv = 'date,asset,category,amount,description\n2026-02-01,Acme SaaS,revenue,100,Sale\n2026-02-02,,hosting,10,AWS\nbad,,hosting,1,x';
    const preview = await ok('POST', '/api/transactions/import/preview', { csv });
    expect(preview.rows.map((r: { errors: string[] }) => r.errors.length)).toEqual([0, 0, 1]);
    const first = await ok('POST', '/api/transactions/import/commit', { csv, filename: 'a.csv' });
    expect(first).toMatchObject({ imported: 2, skipped: 1 });
    expect((await ok('POST', '/api/transactions/import/commit', { csv, filename: 'a.csv' })).imported).toBe(0);
    expect((await ok('POST', '/api/transactions/import/commit', { csv, filename: 'a.csv', includeDuplicates: [2] })).imported).toBe(1);
    expect(await ok('GET', '/api/transactions')).toHaveLength(3);
    await ok('DELETE', `/api/import-batches/${first.batchId}`);
    expect(await ok('GET', '/api/transactions')).toHaveLength(1);
  });
  it('exports CSV that re-imports as duplicates', async () => {
    await ok('POST', '/api/assets', asset);
    await ok('POST', '/api/transactions', { date: '2026-02-01', asset_id: 1, category: 'marketing', amount: 1234, description: 'Ads, "Q1"' });
    const out = await call('GET', '/api/transactions/export.csv');
    const text = await out.blob!.text();
    expect(text).toContain('2026-02-01,Acme SaaS,marketing,12.34,"Ads, ""Q1"""');
    const preview = await ok('POST', '/api/transactions/import/preview', { csv: text });
    expect(preview.rows[0]).toMatchObject({ amount: 1234, duplicate: 'existing', errors: [] });
  });
  it('bulk deletes', async () => {
    for (let i = 1; i <= 3; i++) await ok('POST', '/api/transactions', { date: '2026-02-01', category: 'revenue', amount: i });
    expect((await ok('POST', '/api/transactions/bulk-delete', { ids: [1, 3] })).removed).toBe(2);
    expect(await ok('GET', '/api/transactions')).toHaveLength(1);
  });
});

describe('tasks', () => {
  it('sets and clears completion date with status', async () => {
    const t = await ok('POST', '/api/tasks', { title: 'Ship', priority: 'high', status: 'next' });
    expect((await ok('PATCH', `/api/tasks/${t.id}`, { status: 'completed' })).completed_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await ok('PATCH', `/api/tasks/${t.id}`, { status: 'in_progress' })).completed_at).toBeNull();
  });
});

describe('opportunities', () => {
  it('stores assumptions and converts to an asset once', async () => {
    const assumptions = { annualProfitOverride: null, notes: '', pessimistic: { multiple: 2, growthPct: 0, discountPct: 20, years: 5, exitMultiple: 2 }, base: { multiple: 3, growthPct: 5, discountPct: 15, years: 5, exitMultiple: 3 }, optimistic: { multiple: 4, growthPct: 10, discountPct: 12, years: 5, exitMultiple: 4 } };
    const o = await ok('POST', '/api/opportunities', { name: 'Newsletter X', category: 'media', stage: 'offer', assumptions });
    expect(o.assumptions.base.multiple).toBe(3);
    await ok('POST', '/api/notes', { title: 'DD', kind: 'acquisition', opportunity_id: o.id });
    const conv = await ok('POST', `/api/opportunities/${o.id}/convert`, { price: 50_000_00, date: '2026-10-01' });
    expect(await ok('GET', `/api/assets/${conv.assetId}`)).toMatchObject({ origin: 'acquired', acquisition_price: 50_000_00 });
    expect((await ok('GET', `/api/opportunities/${o.id}`)).stage).toBe('acquired');
    expect((await ok('GET', '/api/notes'))[0].asset_id).toBe(conv.assetId);
    expect((await ok('GET', '/api/valuations'))[0].value).toBe(50_000_00);
    expect((await call('POST', `/api/opportunities/${o.id}/convert`, { price: 1, date: '2026-10-01' })).status).toBe(409);
  });
  it('enforces one set of figures per month', async () => {
    const o = await ok('POST', '/api/opportunities', { name: 'X', category: 'media', stage: 'idea' });
    const row = { opportunity_id: o.id, period: '2026-01', revenue: 1, profit: 1 };
    await ok('POST', '/api/opp-financials', row);
    expect((await call('POST', '/api/opp-financials', row)).status).toBe(409);
  });
});

describe('reviews', () => {
  it('allows one review per month and scope', async () => {
    await ok('POST', '/api/reviews', { month: '2026-09', improved: 'x' });
    expect((await call('POST', '/api/reviews', { month: '2026-09' })).status).toBe(409);
    expect(await ok('GET', '/api/reviews?asset_id=null')).toHaveLength(1);
  });
});

describe('documents', () => {
  it('uploads, reads back and deletes files', async () => {
    const data = new Uint8Array([0, 1, 2, 3, 255]);
    const up = await ok('POST', '/api/documents?filename=contract.bin', new Blob([data], { type: 'application/octet-stream' }));
    expect(up).toMatchObject({ filename: 'contract.bin', size: 5 });
    const file = await call('GET', `/api/documents/${up.id}/file`);
    expect(new Uint8Array(await file.blob!.arrayBuffer())).toEqual(data);
    await call('DELETE', `/api/documents/${up.id}`);
    expect(p.files.size).toBe(0);
  });
});

describe('backup and restore', () => {
  it('round-trips records and documents through a backup file', async () => {
    await ok('POST', '/api/assets', asset);
    await ok('POST', '/api/documents?filename=a.txt&asset_id=1', new Blob(['hello'], { type: 'text/plain' }));
    const backup = await call('GET', '/api/backup');
    expect(backup.filename).toMatch(/^holding-company-backup-.*\.json$/);
    expect((await ok('GET', '/api/snapshot')).meta.lastBackupAt).toBeTruthy();

    await ok('POST', '/api/assets', { ...asset, name: 'Second' });
    await call('DELETE', '/api/documents/1');
    expect(await ok('GET', '/api/assets')).toHaveLength(2);

    expect((await call('POST', '/api/restore', new Blob(['not json']))).status).toBe(422);
    expect((await call('POST', '/api/restore', new Blob([JSON.stringify({ app_id: 'other', tables: {} })]))).status).toBe(422);
    await ok('POST', '/api/restore', backup.blob);
    expect((await ok('GET', '/api/assets')).map((x: { name: string }) => x.name)).toEqual(['Acme SaaS']);
    expect(await (await call('GET', '/api/documents/1/file')).blob!.text()).toBe('hello');
    // a restore point of the pre-restore data was kept
    const points = await ok('GET', '/api/backups');
    expect(points[0].reason).toBe('before restore');
    await ok('POST', `/api/backups/${encodeURIComponent(points[0].key)}/restore`);
    expect(await ok('GET', '/api/assets')).toHaveLength(2);
  });
  it('keeps a daily automatic restore point', async () => {
    await ok('POST', '/api/assets', asset);
    const again = new LocalServer(p, { autoSnapshot: true });
    expect((await again.request('GET', '/api/backups')).body).toHaveLength(1);
    const third = new LocalServer(p, { autoSnapshot: true });
    expect((await third.request('GET', '/api/backups')).body).toHaveLength(1);
  });
});

describe('search & settings', () => {
  it('searches across record types', async () => {
    await ok('POST', '/api/assets', { ...asset, description: 'analytics for shops' });
    await ok('POST', '/api/notes', { title: 'Shop analytics thesis', kind: 'thesis' });
    const hits = await ok('GET', '/api/search?q=analytics');
    expect(hits.map((h: { type: string }) => h.type).sort()).toEqual(['asset', 'note']);
  });
  it('saves validated settings', async () => {
    expect((await ok('PUT', '/api/settings', { company_name: 'HC Holdings', currency: 'USD', fiscal_year_start: 1 })).currency).toBe('USD');
    expect((await call('PUT', '/api/settings', { company_name: '', currency: 'usd', fiscal_year_start: 1 })).status).toBe(422);
  });
});

describe('IndexedDB persistence', () => {
  it('survives a reload', async () => {
    const factory = new IDBFactory();
    const s1 = new LocalServer(new IndexedDbPersistence(factory, 'test'));
    await s1.request('POST', '/api/assets', asset);
    await s1.request('POST', '/api/documents?filename=x.txt', new Blob(['abc']));
    const s2 = new LocalServer(new IndexedDbPersistence(factory, 'test'));
    expect(((await s2.request('GET', '/api/assets')).body as unknown[]).length).toBe(1);
    expect(await (await s2.request('GET', '/api/documents/1/file')).blob!.text()).toBe('abc');
  });
});
