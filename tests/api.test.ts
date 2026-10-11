import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app';
import { Store } from '../server/store';

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp({ store: Store.memory() });
});

const asset = { name: 'Acme SaaS', category: 'saas', status: 'operating', origin: 'acquired', acquisition_price: 1_000_000, start_date: '2026-01-01' };

describe('assets', () => {
  it('creates, reads, updates, archives and deletes', async () => {
    const created = await request(app).post('/api/assets').send(asset).expect(201);
    expect(created.body).toMatchObject({ name: 'Acme SaaS', archived: false, acquisition_price: 1_000_000 });
    const id = created.body.id;
    await request(app).patch(`/api/assets/${id}`).send({ archived: true }).expect(200);
    expect((await request(app).get(`/api/assets/${id}`)).body.archived).toBe(true);
    await request(app).delete(`/api/assets/${id}`).expect(204);
    await request(app).get(`/api/assets/${id}`).expect(404);
  });
  it('rejects invalid input with field errors', async () => {
    const r = await request(app).post('/api/assets').send({ ...asset, name: '', url: 'not a url', category: 'nope' }).expect(422);
    expect(Object.keys(r.body.fields)).toEqual(expect.arrayContaining(['name', 'url', 'category']));
  });
  it('refuses to delete an asset with transactions unless confirmed', async () => {
    const { body: a } = await request(app).post('/api/assets').send(asset);
    await request(app).post('/api/transactions').send({ date: '2026-02-01', asset_id: a.id, category: 'revenue', amount: 100 }).expect(201);
    const r = await request(app).delete(`/api/assets/${a.id}`).expect(409);
    expect(r.body.error).toMatch(/1 financial transaction/);
    await request(app).delete(`/api/assets/${a.id}?withTransactions=1`).expect(204);
    expect((await request(app).get('/api/transactions')).body).toHaveLength(0);
  });
});

describe('transactions', () => {
  it('validates amount and date', async () => {
    const r = await request(app).post('/api/transactions').send({ date: '2026-02-30', category: 'revenue', amount: 0 }).expect(422);
    expect(r.body.fields).toHaveProperty('date');
    expect(r.body.fields).toHaveProperty('amount');
  });
  it('rejects unknown asset', async () => {
    await request(app).post('/api/transactions').send({ date: '2026-02-01', asset_id: 99, category: 'revenue', amount: 1 }).expect(422);
  });
  it('imports CSV with duplicate protection and can undo a batch', async () => {
    await request(app).post('/api/assets').send(asset);
    const csv = 'date,asset,category,amount,description\n2026-02-01,Acme SaaS,revenue,100,Sale\n2026-02-02,,hosting,10,AWS\nbad,,hosting,1,x';
    const preview = await request(app).post('/api/transactions/import/preview').send({ csv }).expect(200);
    expect(preview.body.rows.map((r: { errors: string[] }) => r.errors.length)).toEqual([0, 0, 1]);
    const first = await request(app).post('/api/transactions/import/commit').send({ csv, filename: 'a.csv' }).expect(200);
    expect(first.body).toMatchObject({ imported: 2, skipped: 1 });
    const again = await request(app).post('/api/transactions/import/commit').send({ csv, filename: 'a.csv' }).expect(200);
    expect(again.body.imported).toBe(0);
    const forced = await request(app).post('/api/transactions/import/commit').send({ csv, filename: 'a.csv', includeDuplicates: [2] }).expect(200);
    expect(forced.body.imported).toBe(1);
    expect((await request(app).get('/api/transactions')).body).toHaveLength(3);
    await request(app).delete(`/api/import-batches/${first.body.batchId}`).expect(200);
    expect((await request(app).get('/api/transactions')).body).toHaveLength(1);
  });
  it('exports CSV that re-imports cleanly', async () => {
    await request(app).post('/api/assets').send(asset);
    await request(app).post('/api/transactions').send({ date: '2026-02-01', asset_id: 1, category: 'marketing', amount: 1234, description: 'Ads, "Q1"' });
    const out = await request(app).get('/api/transactions/export.csv').expect(200);
    expect(out.text).toContain('2026-02-01,Acme SaaS,marketing,12.34,"Ads, ""Q1"""');
    const preview = await request(app).post('/api/transactions/import/preview').send({ csv: out.text });
    expect(preview.body.rows[0]).toMatchObject({ amount: 1234, duplicate: 'existing', errors: [] });
  });
});

describe('tasks', () => {
  it('sets and clears completion date with status', async () => {
    const { body } = await request(app).post('/api/tasks').send({ title: 'Ship', priority: 'high', status: 'next' }).expect(201);
    const done = await request(app).patch(`/api/tasks/${body.id}`).send({ status: 'completed' });
    expect(done.body.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const reopened = await request(app).patch(`/api/tasks/${body.id}`).send({ status: 'in_progress' });
    expect(reopened.body.completed_at).toBeNull();
  });
});

describe('opportunities', () => {
  it('stores assumptions and converts to an asset once', async () => {
    const assumptions = { annualProfitOverride: null, notes: '', pessimistic: { multiple: 2, growthPct: 0, discountPct: 20, years: 5, exitMultiple: 2 }, base: { multiple: 3, growthPct: 5, discountPct: 15, years: 5, exitMultiple: 3 }, optimistic: { multiple: 4, growthPct: 10, discountPct: 12, years: 5, exitMultiple: 4 } };
    const { body: o } = await request(app).post('/api/opportunities').send({ name: 'Newsletter X', category: 'media', stage: 'offer', assumptions }).expect(201);
    expect(o.assumptions.base.multiple).toBe(3);
    const conv = await request(app).post(`/api/opportunities/${o.id}/convert`).send({ price: 50_000_00, date: '2026-10-01' }).expect(200);
    const a = await request(app).get(`/api/assets/${conv.body.assetId}`);
    expect(a.body).toMatchObject({ origin: 'acquired', acquisition_price: 50_000_00 });
    expect((await request(app).get(`/api/opportunities/${o.id}`)).body.stage).toBe('acquired');
    await request(app).post(`/api/opportunities/${o.id}/convert`).send({ price: 1, date: '2026-10-01' }).expect(409);
  });
});

describe('reviews', () => {
  it('allows one review per month and scope', async () => {
    await request(app).post('/api/reviews').send({ month: '2026-09', improved: 'x' }).expect(201);
    await request(app).post('/api/reviews').send({ month: '2026-09' }).expect(409);
  });
});

describe('documents', () => {
  it('uploads and downloads binary files', async () => {
    const data = Buffer.from([0, 1, 2, 3, 255]);
    const up = await request(app).post('/api/documents?filename=contract.bin').set('Content-Type', 'application/octet-stream').send(data).expect(201);
    expect(up.body).toMatchObject({ filename: 'contract.bin', size: 5 });
    expect(up.body).not.toHaveProperty('data');
    const list = await request(app).get('/api/documents');
    expect(list.body[0]).not.toHaveProperty('data');
    const file = await request(app).get(`/api/documents/${up.body.id}/file`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(Buffer.compare(file.body, data)).toBe(0);
    expect(file.headers['content-disposition']).toMatch(/^attachment/);
  });
});

describe('auth', () => {
  it('requires the password when configured', async () => {
    const secured = createApp({ store: Store.memory(), password: 's3cret' });
    await request(secured).get('/api/assets').expect(401);
    await request(secured).post('/api/auth/login').send({ password: 'wrong' }).expect(401);
    const ok = await request(secured).post('/api/auth/login').send({ password: 's3cret' }).expect(200);
    const cookie = ok.headers['set-cookie'][0].split(';')[0];
    await request(secured).get('/api/assets').set('Cookie', cookie).expect(200);
  });
});

describe('backup and restore', () => {
  it('round-trips the database file and rejects foreign files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hcos-'));
    try {
      const store = new Store(dir);
      const a = createApp({ store });
      await request(a).post('/api/assets').send(asset).expect(201);
      const backupFile = await store.backup('manual');
      await request(a).post('/api/assets').send({ ...asset, name: 'Second' }).expect(201);
      expect((await request(a).get('/api/assets')).body).toHaveLength(2);

      await request(a).post('/api/restore').set('Content-Type', 'application/octet-stream').send(Buffer.from('not a database')).expect(422);
      await request(a).post('/api/restore').set('Content-Type', 'application/octet-stream').send(fs.readFileSync(backupFile)).expect(200);
      const after = await request(a).get('/api/assets');
      expect(after.body.map((x: { name: string }) => x.name)).toEqual(['Acme SaaS']);
      expect(store.listBackups().some((b) => b.file.startsWith('pre-restore-'))).toBe(true);
      store.db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
