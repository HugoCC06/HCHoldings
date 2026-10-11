# Holding Company OS

A private, single-user operating system for running a personal digital holding company:
portfolio dashboard, asset register, financial records, projects and tasks, acquisition
pipeline with valuation calculators, notes and documents, monthly reviews and reports.

It is deliberately **not** a SaaS: no sign-up, no tenants, no billing, no external integrations.
Everything runs on your own machine and lives in one SQLite file.

## Quick start

```bash
npm install
npm run build
npm start            # http://127.0.0.1:4310
```

Development mode (hot reload for UI and API):

```bash
npm run dev          # UI on http://127.0.0.1:5173, API on :4310
```

Requires Node.js 20+.

### Configuration

Copy `.env.example` values into your shell or a process manager. All optional:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4310` | Port for the API and built UI |
| `HOST` | `127.0.0.1` | Interface to bind. Keep it local unless you also set a password |
| `DATA_DIR` | `./data` | Where the database and automatic backups live |
| `APP_PASSWORD` | – | If set, the app asks for this password (signed, HTTP-only session cookie, 30 days) |

### Try it with sample data

```bash
DATA_DIR=./demo-data npx tsx scripts/seed-demo.ts
DATA_DIR=./demo-data npm start
```

The seed script refuses to touch `./data` or any database that already has assets.

## Architecture

```
shared/   Pure TypeScript used by both sides — domain vocabularies, validation (zod),
          money/date helpers, and every financial calculation (finance.ts, valuation.ts,
          insights.ts, csv.ts). This is the tested core.
server/   Express + better-sqlite3. Generic validated CRUD (resource.ts), CSV import/export,
          documents, search, backup/restore (store.ts), schema migrations (db.ts).
src/      React + Vite + TanStack Query + Recharts. Pages per area, shared UI kit.
tests/    Vitest: calculations, CSV parsing/dedup, API behaviour, backup/restore, auth.
```

Design decisions:

* **One SQLite file holds everything**, including uploaded documents (as BLOBs). A backup is
  one file; restoring is uploading that file.
* **Money is stored as integer minor units** (pence/cents). No floating-point drift.
* **Figures are always derived from records.** Nothing is hard-coded or estimated for you;
  empty states appear until there is data.
* **Transaction categories carry a class** that fixes how they are treated:
  `revenue` and `opex` make up operating profit; `capital` (one-off investments,
  acquisition costs) adds to invested capital only; `owner` (contributions, distributions)
  affects cash flow only. Cash balances are separate dated snapshots. Estimated values are
  separate dated valuations. These never mix.
* **Capital invested** in an asset = its purchase price + capital transactions against it.
* **ROIC** = trailing-12-month operating profit ÷ capital invested. With less than
  12 months of history, profit is annualised and the figure is marked with `*`.
* "Monthly" dashboard figures use the **last complete calendar month**.

## Data safety

* An automatic backup is taken on start-up and then daily (`DATA_DIR/backups`, last 14 kept).
* Settings → Backup lets you download a backup, create one on demand, restore from a file
  (validated first; a safety backup of the current data is taken before replacing), and export
  everything as JSON.
* CSV imports detect duplicates (against existing records and within the file), show a preview
  with per-row errors before anything is saved, and each import batch can be undone.
* The server binds to `127.0.0.1` by default and stores data with owner-only file permissions.

## What's in it

| Area | What you can do |
|---|---|
| **Dashboard** | KPIs for the last complete month (owned/in-development assets, revenue, expenses, operating profit, capital invested, estimated value, cash, ROIC), warnings, next actions, milestones, pipeline, and charts for revenue/expenses/profit, revenue by asset, portfolio value vs capital invested, capital by asset and revenue concentration |
| **Assets** | Owned, in-development, ideas and archived tabs; logo, URL, category, dates, purchase price, valuations history, business/revenue model, objectives, risks, time required. Detail page with P&L, transactions, valuations, work, goals, metrics, reviews, notes and documents |
| **Finance** | Transactions per asset or holding company, filters by asset/category/date/text, bulk delete, CSV import (preview, validation, duplicate detection, undo) and export, monthly P&L statement, cash balance snapshots |
| **Projects & tasks** | Kanban (drag and drop), list, month calendar, projects with progress, milestones |
| **Performance** | Side-by-side comparison incl. ROIC, profit per hour, audience, risk and growth potential; goals vs actuals; monthly reviews |
| **Acquisitions** | Pipeline by stage, verified vs seller-reported monthly figures, valuation calculator (multiple + DCF, three scenarios, IRR, yield, payback, max price), convert to an owned asset |
| **Notes & documents** | Typed notes with tags and links to assets/projects/opportunities, file uploads, search |
| **Reports** | Printable monthly report and CSV export |
| **Settings** | Company name, currency, backups, restore, JSON export |

Press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> anywhere to search.

## Tests

```bash
npm test
npm run typecheck
```
