import { Router, type Request } from 'express';
import type Database from 'better-sqlite3';
import { z, type ZodTypeAny } from 'zod';
import { HttpError } from './errors';

type Row = Record<string, unknown>;

export interface ResourceDef {
  table: string;
  schema: z.ZodObject<Record<string, ZodTypeAny>>;
  /** Columns stored as 0/1 and returned as booleans */
  bools?: string[];
  /** Columns stored as JSON text */
  json?: string[];
  /** Columns that may be used as exact-match filters in ?column=value */
  filters?: string[];
  orderBy: string;
  /** Explicit column list for SELECTs (defaults to *) */
  columns?: string;
  /** Columns never returned in list/get responses */
  hidden?: string[];
  /** Adjust validated data before it is written. `existing` is set on update. */
  prepare?: (data: Row, existing: Row | null, db: Database.Database) => Row;
  /** Called before deletion; throw HttpError to refuse. */
  beforeDelete?: (id: number, req: Request, db: Database.Database) => void;
}

export function decodeRow(def: Pick<ResourceDef, 'bools' | 'json'>, row: Row | undefined): Row | undefined {
  if (!row) return row;
  const out: Row = { ...row };
  for (const b of def.bools ?? []) out[b] = !!out[b];
  for (const j of def.json ?? []) out[j] = typeof out[j] === 'string' ? JSON.parse(out[j] as string) : null;
  return out;
}

function encode(def: ResourceDef, data: Row): Row {
  const out: Row = { ...data };
  for (const b of def.bools ?? []) if (b in out) out[b] = out[b] ? 1 : 0;
  for (const j of def.json ?? []) if (j in out) out[j] = out[j] === null || out[j] === undefined ? null : JSON.stringify(out[j]);
  return out;
}

export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id');
  return id;
}

export function validate<T extends ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new HttpError(422, 'Please correct the highlighted fields.', r.error.flatten().fieldErrors as Record<string, string[]>);
  }
  return r.data;
}

/** Builds list/get/create/update/patch/delete routes for a table. */
export function resourceRouter(def: ResourceDef, getDb: () => Database.Database): Router {
  const r = Router();
  const cols = def.columns ?? '*';
  const select = (db: Database.Database, id: number) => {
    const row = db.prepare(`SELECT ${cols} FROM ${def.table} WHERE id = ?`).get(id) as Row | undefined;
    if (!row) throw new HttpError(404, 'Not found');
    return row;
  };
  const strip = (row: Row | undefined) => {
    if (!row) return row;
    for (const h of def.hidden ?? []) delete row[h];
    return decodeRow(def, row);
  };

  r.get('/', (req, res) => {
    const db = getDb();
    const where: string[] = [];
    const params: unknown[] = [];
    for (const f of def.filters ?? []) {
      const v = req.query[f];
      if (typeof v !== 'string') continue;
      if (v === 'null') where.push(`${f} IS NULL`);
      else {
        where.push(`${f} = ?`);
        params.push(/^\d+$/.test(v) ? Number(v) : v);
      }
    }
    const sql = `SELECT ${cols} FROM ${def.table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${def.orderBy}`;
    res.json((db.prepare(sql).all(...params) as Row[]).map(strip));
  });

  r.get('/:id', (req, res) => {
    res.json(strip(select(getDb(), parseId(req.params.id))));
  });

  const write = (data: Row, existing: Row | null) => {
    const db = getDb();
    const prepared = encode(def, def.prepare ? def.prepare(data, existing ? decodeRow(def, existing)! : null, db) : data);
    if (existing) {
      const keys = Object.keys(prepared);
      if (keys.length) {
        db.prepare(`UPDATE ${def.table} SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = datetime('now') WHERE id = @__id`).run({ ...prepared, __id: existing.id });
      }
      return existing.id as number;
    }
    const keys = Object.keys(prepared);
    const info = db.prepare(`INSERT INTO ${def.table} (${keys.join(', ')}) VALUES (${keys.map((k) => '@' + k).join(', ')})`).run(prepared);
    return Number(info.lastInsertRowid);
  };

  r.post('/', (req, res) => {
    const data = validate(def.schema, req.body);
    const id = getDb().transaction(() => write(data, null))();
    res.status(201).json(strip(select(getDb(), id)));
  });

  r.put('/:id', (req, res) => {
    const id = parseId(req.params.id);
    const data = validate(def.schema, req.body);
    getDb().transaction(() => write(data, select(getDb(), id)))();
    res.json(strip(select(getDb(), id)));
  });

  r.patch('/:id', (req, res) => {
    const id = parseId(req.params.id);
    const db = getDb();
    db.transaction(() => {
      const existing = select(db, id);
      // Validate the merged record so partial updates obey the same rules as full ones.
      const merged = { ...decodeRow(def, existing), ...(req.body ?? {}) };
      const data = validate(def.schema, merged);
      write(data, existing);
    })();
    res.json(strip(select(db, id)));
  });

  r.delete('/:id', (req, res) => {
    const id = parseId(req.params.id);
    const db = getDb();
    select(db, id);
    db.transaction(() => {
      def.beforeDelete?.(id, req, db);
      db.prepare(`DELETE FROM ${def.table} WHERE id = ?`).run(id);
    })();
    res.status(204).end();
  });

  return r;
}
