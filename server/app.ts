import express, { type NextFunction, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  assetSchema, cashAccountSchema, cashBalanceSchema, documentMetaSchema, goalSchema, metricSchema, milestoneSchema,
  noteSchema, oppFinancialSchema, opportunitySchema, projectSchema, reviewSchema, settingsSchema, taskSchema,
  transactionSchema, valuationSchema,
} from '../shared/schemas';
import { TXN_CATEGORIES } from '../shared/domain';
import { TXN_CSV_HEADER, toCsv, txnFingerprint, validateTxnCsv } from '../shared/csv';
import { minorToInput } from '../shared/money';
import { todayISO } from '../shared/dates';
import { HttpError } from './errors';
import { decodeRow, parseId, resourceRouter, validate } from './resource';
import type { Store } from './store';

const DEFAULT_SETTINGS = { company_name: 'Holding Company', currency: 'GBP', fiscal_year_start: 1 };

export interface AppOptions {
  store: Store;
  password?: string;
  staticDir?: string;
}

export function createApp({ store, password, staticDir }: AppOptions) {
  const app = express();
  const db = () => store.db;
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use('/api', express.json({ limit: '2mb' }));

  // ---------- Optional password protection ----------
  const secret = () => {
    const row = db().prepare(`SELECT value FROM app_meta WHERE key = 'session_secret'`).get() as { value: string } | undefined;
    if (row) return row.value;
    const s = crypto.randomBytes(32).toString('hex');
    db().prepare(`INSERT INTO app_meta (key, value) VALUES ('session_secret', ?)`).run(s);
    return s;
  };
  const sign = (payload: string) => crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  const readCookie = (req: Request, name: string) =>
    (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1];
  const isAuthed = (req: Request) => {
    if (!password) return true;
    const token = readCookie(req, 'hcos_session');
    if (!token) return false;
    const [issued, sig] = decodeURIComponent(token).split('.');
    if (!issued || !sig) return false;
    const expected = sign(issued);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    return Date.now() - Number(issued) < 30 * 86_400_000;
  };
  app.get('/api/auth', (req, res) => res.json({ required: !!password, authenticated: isAuthed(req) }));
  app.post('/api/auth/login', (req, res) => {
    const given = String(req.body?.password ?? '');
    const a = crypto.createHash('sha256').update(given).digest();
    const b = crypto.createHash('sha256').update(password ?? '').digest();
    if (!password || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'Incorrect password');
    const issued = String(Date.now());
    res.setHeader('Set-Cookie', `hcos_session=${encodeURIComponent(`${issued}.${sign(issued)}`)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86400}`);
    res.json({ ok: true });
  });
  app.post('/api/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', 'hcos_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });
  app.use('/api', (req, _res, next) => (isAuthed(req) ? next() : next(new HttpError(401, 'Login required'))));

  // ---------- Settings ----------
  const readSettings = () => {
    const rows = db().prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
    const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of rows) s[r.key] = JSON.parse(r.value);
    return s;
  };
  app.get('/api/settings', (_req, res) => res.json(readSettings()));
  app.put('/api/settings', (req, res) => {
    const data = validate(settingsSchema, req.body);
    const stmt = db().prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    db().transaction(() => Object.entries(data).forEach(([k, v]) => stmt.run(k, JSON.stringify(v))))();
    res.json(readSettings());
  });

  // ---------- Assets ----------
  app.use(
    '/api/assets',
    resourceRouter(
      {
        table: 'assets',
        schema: assetSchema,
        bools: ['archived'],
        orderBy: 'archived, name COLLATE NOCASE',
        beforeDelete: (id, req, d) => {
          const n = (d.prepare(`SELECT COUNT(*) n FROM transactions WHERE asset_id = ?`).get(id) as { n: number }).n;
          if (n && req.query.withTransactions !== '1')
            throw new HttpError(409, `This asset has ${n} financial transaction${n > 1 ? 's' : ''}. Archive it instead, or confirm deleting its transactions too.`);
          d.prepare(`DELETE FROM transactions WHERE asset_id = ?`).run(id);
          d.prepare(`UPDATE opportunities SET converted_asset_id = NULL WHERE converted_asset_id = ?`).run(id);
        },
      },
      db,
    ),
  );
  app.use('/api/valuations', resourceRouter({ table: 'valuations', schema: valuationSchema, filters: ['asset_id'], orderBy: 'date DESC, id DESC' }, db));

  // ---------- Transactions ----------
  const fingerprintOf = (d: Record<string, unknown>) =>
    txnFingerprint({ date: d.date as string, amount: d.amount as number, category: d.category as string, asset_id: (d.asset_id as number | null) ?? null, description: (d.description as string | null) ?? null });

  app.get('/api/transactions/export.csv', (req, res) => {
    const { where, params } = txnFilters(req);
    const rows = db()
      .prepare(`SELECT t.*, a.name AS asset_name FROM transactions t LEFT JOIN assets a ON a.id = t.asset_id ${where} ORDER BY t.date, t.id`)
      .all(...params) as Record<string, unknown>[];
    const csv = toCsv(TXN_CSV_HEADER, rows.map((r) => [r.date, r.asset_name ?? 'Holding company', r.category, minorToInput(r.amount as number), r.description, r.counterparty, r.notes]));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="transactions-${todayISO()}.csv"`);
    res.send(csv);
  });

  const importBody = z.object({ csv: z.string().max(10_000_000), filename: z.string().max(255).default('import.csv') });
  const importContext = () => ({
    assets: db().prepare(`SELECT id, name FROM assets`).all() as { id: number; name: string }[],
    existing: new Set((db().prepare(`SELECT fingerprint FROM transactions`).all() as { fingerprint: string }[]).map((r) => r.fingerprint)),
  });
  app.post('/api/transactions/import/preview', (req, res) => {
    const { csv } = validate(importBody, req.body);
    const ctx = importContext();
    res.json(validateTxnCsv(csv, ctx.assets, ctx.existing));
  });
  app.post('/api/transactions/import/commit', (req, res) => {
    const body = validate(importBody.extend({ includeDuplicates: z.array(z.number().int()).default([]) }), req.body);
    const ctx = importContext();
    const { rows, headerErrors } = validateTxnCsv(body.csv, ctx.assets, ctx.existing);
    if (headerErrors.length) throw new HttpError(422, headerErrors.join(' '));
    const include = new Set(body.includeDuplicates);
    const valid = rows.filter((r) => !r.errors.length && (!r.duplicate || include.has(r.line)));
    const result = db().transaction(() => {
      const batch = db().prepare(`INSERT INTO import_batches (filename, row_count, skipped_count) VALUES (?, ?, ?)`).run(body.filename, valid.length, rows.length - valid.length);
      const ins = db().prepare(
        `INSERT INTO transactions (date, asset_id, category, amount, description, counterparty, notes, source, import_batch_id, fingerprint)
         VALUES (@date, @asset_id, @category, @amount, @description, @counterparty, @notes, 'import', @batch, @fingerprint)`,
      );
      for (const r of valid) ins.run({ ...r, batch: batch.lastInsertRowid });
      return { batchId: Number(batch.lastInsertRowid), imported: valid.length, skipped: rows.length - valid.length };
    })();
    res.json(result);
  });
  app.get('/api/import-batches', (_req, res) => res.json(db().prepare(`SELECT * FROM import_batches ORDER BY id DESC`).all()));
  app.delete('/api/import-batches/:id', (req, res) => {
    const id = parseId(req.params.id);
    const removed = db().transaction(() => {
      const n = db().prepare(`DELETE FROM transactions WHERE import_batch_id = ?`).run(id).changes;
      db().prepare(`DELETE FROM import_batches WHERE id = ?`).run(id);
      return n;
    })();
    res.json({ removed });
  });
  app.post('/api/transactions/bulk-delete', (req, res) => {
    const { ids } = validate(z.object({ ids: z.array(z.number().int().positive()).min(1).max(10_000) }), req.body);
    const stmt = db().prepare(`DELETE FROM transactions WHERE id = ?`);
    const removed = db().transaction(() => ids.reduce((n, id) => n + stmt.run(id).changes, 0))();
    res.json({ removed });
  });
  app.use(
    '/api/transactions',
    resourceRouter(
      {
        table: 'transactions',
        schema: transactionSchema,
        filters: ['asset_id', 'category'],
        orderBy: 'date DESC, id DESC',
        prepare: (d, existing) => {
          if (d.asset_id && !db().prepare(`SELECT 1 FROM assets WHERE id = ?`).get(d.asset_id)) throw new HttpError(422, 'Unknown asset', { asset_id: ['Unknown asset'] });
          return { ...d, fingerprint: fingerprintOf(d), ...(existing ? {} : { source: 'manual' }) };
        },
      },
      db,
    ),
  );

  app.use('/api/cash-accounts', resourceRouter({ table: 'cash_accounts', schema: cashAccountSchema, bools: ['archived'], orderBy: 'archived, name COLLATE NOCASE' }, db));
  app.use('/api/cash-balances', resourceRouter({ table: 'cash_balances', schema: cashBalanceSchema, filters: ['account_id'], orderBy: 'date DESC, id DESC' }, db));

  // ---------- Work ----------
  app.use('/api/projects', resourceRouter({ table: 'projects', schema: projectSchema, filters: ['asset_id', 'status'], orderBy: 'name COLLATE NOCASE' }, db));
  app.use(
    '/api/tasks',
    resourceRouter(
      {
        table: 'tasks',
        schema: taskSchema,
        filters: ['asset_id', 'project_id', 'status'],
        orderBy: 'sort_order, id',
        prepare: (d) => {
          // Keep completion date consistent with status.
          if (d.status === 'completed' && !d.completed_at) return { ...d, completed_at: todayISO() };
          if (d.status !== 'completed' && d.completed_at) return { ...d, completed_at: null };
          return d;
        },
      },
      db,
    ),
  );
  app.use('/api/milestones', resourceRouter({ table: 'milestones', schema: milestoneSchema, filters: ['asset_id', 'project_id'], orderBy: 'target_date IS NULL, target_date, id' }, db));

  // ---------- Acquisitions ----------
  app.use('/api/opportunities', resourceRouter({ table: 'opportunities', schema: opportunitySchema, json: ['assumptions'], filters: ['stage'], orderBy: 'updated_at DESC' }, db));
  app.use('/api/opp-financials', resourceRouter({ table: 'opp_financials', schema: oppFinancialSchema, bools: ['verified'], filters: ['opportunity_id'], orderBy: 'period DESC' }, db));
  app.post('/api/opportunities/:id/convert', (req, res) => {
    const id = parseId(req.params.id);
    const body = validate(z.object({ price: z.number().int().min(0).nullable(), date: z.string() }), req.body);
    const assetId = db().transaction(() => {
      const opp = db().prepare(`SELECT * FROM opportunities WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
      if (!opp) throw new HttpError(404, 'Not found');
      if (opp.converted_asset_id) throw new HttpError(409, 'This opportunity has already been converted to an asset.');
      const asset = validate(assetSchema, {
        name: opp.name, url: opp.website, category: opp.category, status: 'operating', origin: 'acquired', start_date: body.date,
        acquisition_price: body.price, business_model: opp.business_model, key_risks: opp.risks,
        description: `Acquired via pipeline.`, notes: opp.dd_notes,
      });
      const keys = Object.keys(asset);
      const info = db().prepare(`INSERT INTO assets (${keys.join(',')}) VALUES (${keys.map((k) => '@' + k).join(',')})`).run({ ...asset, archived: 0 });
      const newId = Number(info.lastInsertRowid);
      if (body.price) db().prepare(`INSERT INTO valuations (asset_id, date, value, method) VALUES (?, ?, ?, 'Purchase price')`).run(newId, body.date, body.price);
      db().prepare(`UPDATE opportunities SET stage = 'acquired', converted_asset_id = ?, updated_at = datetime('now') WHERE id = ?`).run(newId, id);
      db().prepare(`UPDATE notes SET asset_id = ? WHERE opportunity_id = ? AND asset_id IS NULL`).run(newId, id);
      db().prepare(`UPDATE documents SET asset_id = ? WHERE opportunity_id = ? AND asset_id IS NULL`).run(newId, id);
      return newId;
    })();
    res.json({ assetId });
  });

  // ---------- Performance ----------
  app.use('/api/goals', resourceRouter({ table: 'goals', schema: goalSchema, filters: ['asset_id'], orderBy: 'target_date IS NULL, target_date, id' }, db));
  app.use('/api/metrics', resourceRouter({ table: 'metrics', schema: metricSchema, filters: ['asset_id'], orderBy: 'date DESC, id DESC' }, db));
  app.use(
    '/api/reviews',
    resourceRouter(
      {
        table: 'reviews',
        schema: reviewSchema,
        filters: ['month', 'asset_id'],
        orderBy: 'month DESC, asset_id',
        prepare: (d, existing) => {
          const dup = db().prepare(`SELECT id FROM reviews WHERE month = ? AND IFNULL(asset_id, 0) = IFNULL(?, 0)`).get(d.month, d.asset_id) as { id: number } | undefined;
          if (dup && dup.id !== existing?.id) throw new HttpError(409, 'A review for this month and scope already exists.');
          return d;
        },
      },
      db,
    ),
  );

  // ---------- Knowledge base ----------
  app.use('/api/notes', resourceRouter({ table: 'notes', schema: noteSchema, bools: ['pinned'], filters: ['asset_id', 'project_id', 'opportunity_id', 'kind'], orderBy: 'pinned DESC, updated_at DESC' }, db));

  const MAX_UPLOAD = 25 * 1024 * 1024;
  app.post('/api/documents', express.raw({ type: () => true, limit: MAX_UPLOAD }), (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Empty file');
    const num = (v: unknown) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
    const meta = validate(documentMetaSchema, {
      filename: String(req.query.filename ?? '').replace(/[\\/]/g, '_'),
      description: req.query.description,
      asset_id: num(req.query.asset_id), project_id: num(req.query.project_id),
      opportunity_id: num(req.query.opportunity_id), note_id: num(req.query.note_id),
    });
    const mime = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 100);
    const info = db()
      .prepare(`INSERT INTO documents (filename, mime, size, data, description, asset_id, project_id, opportunity_id, note_id) VALUES (@filename, @mime, @size, @data, @description, @asset_id, @project_id, @opportunity_id, @note_id)`)
      .run({ ...meta, mime, size: req.body.length, data: req.body });
    res.status(201).json(db().prepare(`SELECT ${DOC_COLS} FROM documents WHERE id = ?`).get(info.lastInsertRowid));
  });
  app.use(
    '/api/documents',
    resourceRouter({ table: 'documents', schema: documentMetaSchema, columns: DOC_COLS, filters: ['asset_id', 'project_id', 'opportunity_id', 'note_id'], orderBy: 'created_at DESC' }, db),
  );
  app.get('/api/documents/:id/file', (req, res) => {
    const doc = db().prepare(`SELECT filename, mime, data FROM documents WHERE id = ?`).get(parseId(req.params.id)) as { filename: string; mime: string; data: Buffer } | undefined;
    if (!doc) throw new HttpError(404, 'Not found');
    const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(doc.mime) && req.query.download !== '1';
    res.setHeader('Content-Type', doc.mime);
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(doc.filename)}`);
    res.send(doc.data);
  });

  // ---------- Bulk data (used by the UI to compute portfolio figures) ----------
  app.get('/api/snapshot', (_req, res) => {
    const d = db();
    const all = (sql: string) => d.prepare(sql).all() as Record<string, unknown>[];
    res.json({
      settings: readSettings(),
      assets: all(`SELECT * FROM assets ORDER BY archived, name COLLATE NOCASE`).map((r) => decodeRow({ bools: ['archived'] }, r)),
      valuations: all(`SELECT * FROM valuations ORDER BY date, id`),
      transactions: all(`SELECT id, date, asset_id, category, amount FROM transactions ORDER BY date, id`),
      cashAccounts: all(`SELECT * FROM cash_accounts`).map((r) => decodeRow({ bools: ['archived'] }, r)),
      cashBalances: all(`SELECT * FROM cash_balances ORDER BY date, id`),
      projects: all(`SELECT * FROM projects`),
      tasks: all(`SELECT * FROM tasks ORDER BY sort_order, id`),
      milestones: all(`SELECT * FROM milestones ORDER BY target_date IS NULL, target_date, id`),
      opportunities: all(`SELECT * FROM opportunities ORDER BY updated_at DESC`).map((r) => decodeRow({ json: ['assumptions'] }, r)),
      goals: all(`SELECT * FROM goals`),
      metrics: all(`SELECT * FROM metrics ORDER BY date, id`),
    });
  });

  app.get('/api/search', (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return res.json([]);
    const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    const d = db();
    const run = (sql: string) => d.prepare(sql).all({ like }) as Record<string, unknown>[];
    res.json([
      ...run(`SELECT 'asset' type, id, name title, description snippet FROM assets WHERE name LIKE @like ESCAPE '\\' OR description LIKE @like ESCAPE '\\' OR notes LIKE @like ESCAPE '\\' LIMIT 10`),
      ...run(`SELECT 'opportunity' type, id, name title, business_model snippet FROM opportunities WHERE name LIKE @like ESCAPE '\\' OR dd_notes LIKE @like ESCAPE '\\' OR risks LIKE @like ESCAPE '\\' LIMIT 10`),
      ...run(`SELECT 'note' type, id, title, substr(body, 1, 160) snippet FROM notes WHERE title LIKE @like ESCAPE '\\' OR body LIKE @like ESCAPE '\\' OR tags LIKE @like ESCAPE '\\' LIMIT 10`),
      ...run(`SELECT 'task' type, id, title, description snippet FROM tasks WHERE title LIKE @like ESCAPE '\\' OR description LIKE @like ESCAPE '\\' OR notes LIKE @like ESCAPE '\\' LIMIT 10`),
      ...run(`SELECT 'project' type, id, name title, description snippet FROM projects WHERE name LIKE @like ESCAPE '\\' OR description LIKE @like ESCAPE '\\' LIMIT 10`),
      ...run(`SELECT 'document' type, id, filename title, description snippet FROM documents WHERE filename LIKE @like ESCAPE '\\' OR description LIKE @like ESCAPE '\\' LIMIT 10`),
    ]);
  });

  // ---------- Backup & restore ----------
  app.get('/api/backups', (_req, res) => res.json(store.listBackups()));
  app.get('/api/backup', async (_req, res, next) => {
    try {
      const file = await store.backup('download');
      res.download(file, `holding-company-backup-${todayISO()}.sqlite`);
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/backups', async (_req, res, next) => {
    try {
      const file = await store.backup('manual');
      res.status(201).json({ file: path.basename(file) });
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/restore', express.raw({ type: () => true, limit: '2gb' }), async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Upload a backup file.');
      await store.restoreFromBuffer(req.body);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/export.json', (_req, res) => {
    const d = db();
    const tables = ['settings', 'assets', 'valuations', 'transactions', 'import_batches', 'cash_accounts', 'cash_balances', 'projects', 'tasks', 'milestones', 'opportunities', 'opp_financials', 'goals', 'metrics', 'reviews', 'notes'];
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), categories: TXN_CATEGORIES };
    for (const t of tables) out[t] = d.prepare(`SELECT * FROM ${t}`).all();
    out.documents = d.prepare(`SELECT ${DOC_COLS} FROM documents`).all();
    res.setHeader('Content-Disposition', `attachment; filename="holding-company-export-${todayISO()}.json"`);
    res.json(out);
  });

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Unknown endpoint')));

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, fields: err.fields });
    const e = err as { type?: string; status?: number; message?: string; code?: string };
    if (e?.type === 'entity.too.large') return res.status(413).json({ error: 'File is too large.' });
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed request body.' });
    if (e?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return res.status(409).json({ error: 'This record is referenced by other records.' });
    if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'A record with these details already exists.' });
    console.error(err);
    res.status(500).json({ error: 'Unexpected server error. Your data has not been changed.' });
  });

  return app;
}

const DOC_COLS = 'id, filename, mime, size, description, asset_id, project_id, opportunity_id, note_id, created_at, updated_at';

function txnFilters(req: Request) {
  const where: string[] = [];
  const params: unknown[] = [];
  const q = req.query;
  if (typeof q.asset_id === 'string') {
    if (q.asset_id === 'null') where.push('t.asset_id IS NULL');
    else {
      where.push('t.asset_id = ?');
      params.push(Number(q.asset_id));
    }
  }
  if (typeof q.category === 'string' && q.category) {
    const cats = q.category.split(',');
    where.push(`t.category IN (${cats.map(() => '?').join(',')})`);
    params.push(...cats);
  }
  if (typeof q.from === 'string' && q.from) {
    where.push('t.date >= ?');
    params.push(q.from);
  }
  if (typeof q.to === 'string' && q.to) {
    where.push('t.date <= ?');
    params.push(q.to);
  }
  return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

export type { Database };
