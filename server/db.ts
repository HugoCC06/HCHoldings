import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const APP_ID = 'hc-holdings-os';

/** Ordered schema migrations. Never edit a shipped migration; append a new one. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE assets (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    logo TEXT,
    url TEXT,
    category TEXT NOT NULL,
    status TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'built',
    start_date TEXT,
    acquisition_price INTEGER,
    business_model TEXT,
    revenue_model TEXT,
    description TEXT,
    objectives TEXT,
    notes TEXT,
    risk_level TEXT,
    key_risks TEXT,
    growth_potential TEXT,
    weekly_hours REAL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE valuations (
    id INTEGER PRIMARY KEY,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    value INTEGER NOT NULL,
    method TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX valuations_asset ON valuations(asset_id, date);

  CREATE TABLE import_batches (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    row_count INTEGER NOT NULL,
    skipped_count INTEGER NOT NULL
  );

  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    asset_id INTEGER REFERENCES assets(id) ON DELETE RESTRICT,
    category TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    description TEXT,
    counterparty TEXT,
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    import_batch_id INTEGER REFERENCES import_batches(id) ON DELETE SET NULL,
    fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX transactions_date ON transactions(date);
  CREATE INDEX transactions_asset ON transactions(asset_id, date);
  CREATE INDEX transactions_fp ON transactions(fingerprint);

  CREATE TABLE cash_accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    institution TEXT,
    notes TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE cash_balances (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES cash_accounts(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    balance INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    description TEXT,
    status TEXT NOT NULL,
    start_date TEXT,
    target_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL,
    deadline TEXT,
    notes TEXT,
    completed_at TEXT,
    sort_order REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE milestones (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    description TEXT,
    target_date TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE opportunities (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    website TEXT,
    category TEXT NOT NULL,
    stage TEXT NOT NULL,
    source TEXT,
    asking_price INTEGER,
    estimated_value INTEGER,
    max_price INTEGER,
    target_return_pct REAL,
    business_model TEXT,
    audience TEXT,
    growth_opportunities TEXT,
    risks TEXT,
    dd_notes TEXT,
    rejected_reason TEXT,
    assumptions TEXT,
    converted_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE opp_financials (
    id INTEGER PRIMARY KEY,
    opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    period TEXT NOT NULL,
    revenue INTEGER NOT NULL,
    profit INTEGER NOT NULL,
    traffic INTEGER,
    verified INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (opportunity_id, period)
  );

  CREATE TABLE goals (
    id INTEGER PRIMARY KEY,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    metric TEXT NOT NULL,
    metric_name TEXT,
    target_value REAL NOT NULL,
    manual_actual REAL,
    target_date TEXT,
    status TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE metrics (
    id INTEGER PRIMARY KEY,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    value REAL NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY,
    month TEXT NOT NULL,
    asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE,
    improved TEXT, underperformed TEXT, learned TEXT, fix TEXT, stop TEXT, priorities TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX reviews_month_asset ON reviews(month, IFNULL(asset_id, 0));

  CREATE TABLE notes (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT,
    kind TEXT NOT NULL,
    url TEXT,
    tags TEXT,
    asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE documents (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    description TEXT,
    asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
    note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];

export function openDatabase(file: string): Database.Database {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  if (file !== ':memory:') {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* best effort on platforms without chmod */
    }
  }
  return db;
}

export function migrate(db: Database.Database) {
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  db.prepare(`INSERT OR IGNORE INTO app_meta (key, value) VALUES ('app_id', ?)`).run(APP_ID);
}

/** Returns an error message if `file` is not a valid database for this app. */
export function inspectBackup(file: string): string | null {
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') return `Integrity check failed: ${integrity}`;
    const row = db.prepare(`SELECT value FROM app_meta WHERE key = 'app_id'`).get() as { value: string } | undefined;
    if (row?.value !== APP_ID) return 'This file is not a Holding Company OS backup.';
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version > MIGRATIONS.length) return 'This backup was made by a newer version of the app.';
    return null;
  } catch (e) {
    return `Could not read the file as a database: ${(e as Error).message}`;
  } finally {
    db?.close();
  }
}
