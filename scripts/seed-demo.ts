/**
 * Fills a SEPARATE demo database with fictional sample data so you can explore the app.
 * It refuses to run against a database that already has assets.
 *
 *   DATA_DIR=./demo-data npx tsx scripts/seed-demo.ts
 *   DATA_DIR=./demo-data npm start
 */
import path from 'node:path';
import { Store } from '../server/store';
import { addMonths, monthRange, todayISO } from '../shared/dates';

const dir = path.resolve(process.env.DATA_DIR ?? 'demo-data');
if (dir === path.resolve('data')) {
  console.error('Refusing to seed the default ./data directory. Set DATA_DIR to a separate folder, e.g. DATA_DIR=./demo-data');
  process.exit(1);
}
const store = new Store(dir);
const db = store.db;
if ((db.prepare('SELECT COUNT(*) n FROM assets').get() as { n: number }).n > 0) {
  console.error(`Database in ${dir} already has assets — not seeding.`);
  process.exit(1);
}

let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const today = todayISO();
const end = addMonths(today.slice(0, 7), -1);
const months = monthRange(addMonths(end, -17), end);

const insAsset = db.prepare(`INSERT INTO assets (name, url, category, status, origin, start_date, acquisition_price, business_model, revenue_model, description, objectives, risk_level, key_risks, growth_potential, weekly_hours) VALUES (@name, @url, @category, @status, @origin, @start_date, @acquisition_price, @business_model, @revenue_model, @description, @objectives, @risk_level, @key_risks, @growth_potential, @weekly_hours)`);
const insTxn = db.prepare(`INSERT INTO transactions (date, asset_id, category, amount, description, counterparty, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?)`);
const insVal = db.prepare(`INSERT INTO valuations (asset_id, date, value, method) VALUES (?, ?, ?, ?)`);
let fp = 0;
const txn = (date: string, asset: number | null, cat: string, amount: number, desc: string, cp = '') => insTxn.run(date, asset, cat, Math.round(amount), desc, cp, `demo-${fp++}`);

db.transaction(() => {
  const a1 = Number(insAsset.run({ name: 'Ledgerly', url: 'https://example.com/ledgerly', category: 'saas', status: 'operating', origin: 'acquired', start_date: `${months[0]}-03`, acquisition_price: 42_000_00, business_model: 'Bookkeeping SaaS for freelancers', revenue_model: 'Monthly subscriptions', description: 'Small bookkeeping tool acquired from its founder.', objectives: 'Reduce churn below 3%\nLaunch annual plans', risk_level: 'medium', key_risks: 'Dependence on one payments API', growth_potential: 'high', weekly_hours: 8 }).lastInsertRowid);
  const a2 = Number(insAsset.run({ name: 'The Compounder', url: 'https://example.com/compounder', category: 'media', status: 'operating', origin: 'built', start_date: `${months[2]}-01`, acquisition_price: null, business_model: 'Weekly investing newsletter', revenue_model: 'Sponsorships and paid tier', description: 'Finance newsletter with a growing free list.', objectives: 'Reach 20k subscribers', risk_level: 'low', key_risks: 'Sponsor concentration', growth_potential: 'medium', weekly_hours: 6 }).lastInsertRowid);
  const a3 = Number(insAsset.run({ name: 'Pixel Harbor', url: null, category: 'game', status: 'development', origin: 'built', start_date: `${months[9]}-15`, acquisition_price: null, business_model: 'Premium indie game', revenue_model: 'One-off sales on Steam', description: 'Cozy harbour management game.', objectives: 'Ship demo for next festival', risk_level: 'high', key_risks: 'Scope creep', growth_potential: 'medium', weekly_hours: 10 }).lastInsertRowid);
  insAsset.run({ name: 'Niche job board', url: null, category: 'website', status: 'idea', origin: 'built', start_date: null, acquisition_price: null, business_model: 'Job board for climate engineers', revenue_model: 'Paid listings', description: null, objectives: null, risk_level: null, key_risks: null, growth_potential: null, weekly_hours: null });

  months.forEach((m, i) => {
    const mrr = 2400_00 * (1 + i * 0.035) * (0.95 + rnd() * 0.1);
    txn(`${m}-28`, a1, 'revenue', mrr, 'Stripe payout', 'Stripe');
    txn(`${m}-05`, a1, 'hosting', 180_00 + rnd() * 40_00, 'Servers', 'Hetzner');
    txn(`${m}-28`, a1, 'payment_fees', mrr * 0.029, 'Stripe fees', 'Stripe');
    if (i % 3 === 0) txn(`${m}-12`, a1, 'marketing', 300_00 + rnd() * 200_00, 'Search ads', 'Google');
    if (i >= 2) {
      txn(`${m}-20`, a2, 'revenue', (600_00 + (i - 2) * 90_00) * (0.85 + rnd() * 0.3), 'Sponsorship', 'Various');
      txn(`${m}-02`, a2, 'software', 89_00, 'Newsletter platform', 'Beehiiv');
    }
    if (i >= 9) txn(`${m}-10`, a3, 'development', 400_00 + rnd() * 300_00, 'Contract artist', 'Freelancer');
    txn(`${m}-01`, null, 'software', 25_00, 'Accounting software', 'Xero');
  });
  txn(`${months[0]}-03`, a1, 'acquisition_cost', 1_500_00, 'Escrow & legal', 'Escrow.com');
  txn(`${months[4]}-14`, a1, 'investment', 3_000_00, 'Onboarding rebuild', 'Agency');
  txn(`${months[10]}-01`, a3, 'investment', 1_200_00, 'Engine licence & assets', 'Store');
  txn(`${months[0]}-01`, null, 'owner_contribution', 50_000_00, 'Initial capital', 'Owner');

  insVal.run(a1, `${months[0]}-03`, 42_000_00, 'Purchase price');
  insVal.run(a1, `${months[8]}-30`, 55_000_00, '3× annual profit');
  insVal.run(a1, `${months[16]}-30`, 72_000_00, 'Broker estimate');
  insVal.run(a2, `${months[11]}-30`, 12_000_00, '2× annual profit');

  const acc = Number(db.prepare(`INSERT INTO cash_accounts (name, institution) VALUES ('Business current account', 'Starling')`).run().lastInsertRowid);
  db.prepare(`INSERT INTO cash_balances (account_id, date, balance) VALUES (?, ?, ?)`).run(acc, `${end}-28`, 18_450_00);

  const pj = Number(db.prepare(`INSERT INTO projects (name, asset_id, status, description, target_date) VALUES ('Annual plans launch', ?, 'active', 'Introduce annual billing with 2 months free', ?)`).run(a1, `${addMonths(end, 2)}-15`).lastInsertRowid);
  const task = db.prepare(`INSERT INTO tasks (title, asset_id, project_id, priority, status, deadline, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  task.run('Design annual pricing page', a1, pj, 'high', 'in_progress', `${today.slice(0, 7)}-20`, 1);
  task.run('Update Stripe products', a1, pj, 'medium', 'next', `${today.slice(0, 7)}-25`, 2);
  task.run('Email existing customers about annual plans', a1, pj, 'medium', 'backlog', null, 3);
  task.run('Renew sponsorship deck', a2, null, 'high', 'next', `${addMonths(today.slice(0, 7), -1)}-28`, 4);
  task.run('Book festival demo slot', a3, null, 'critical', 'waiting', `${today.slice(0, 7)}-28`, 5);
  task.run('File annual accounts', null, null, 'high', 'backlog', `${addMonths(today.slice(0, 7), 2)}-30`, 6);
  db.prepare(`INSERT INTO milestones (title, asset_id, kind, target_date) VALUES ('Playable demo', ?, 'release', ?)`).run(a3, `${addMonths(today.slice(0, 7), 1)}-15`);
  db.prepare(`INSERT INTO milestones (title, asset_id, kind, target_date) VALUES ('£5k MRR', ?, 'revenue', ?)`).run(a1, `${addMonths(today.slice(0, 7), 3)}-01`);

  const opp = Number(db.prepare(`INSERT INTO opportunities (name, website, category, stage, source, asking_price, business_model, audience, growth_opportunities, risks, max_price, target_return_pct) VALUES ('Recipe SEO site', 'https://example.com/recipes', 'website', 'due_diligence', 'Marketplace listing', 36_000_00, 'Display ads on recipe content', '120k monthly visits, 70% Google organic', 'Add email list; expand to meal plans', 'Google algorithm updates; AI overviews', 30_000_00, 30)`).run().lastInsertRowid);
  const fin = db.prepare(`INSERT INTO opp_financials (opportunity_id, period, revenue, profit, traffic, verified) VALUES (?, ?, ?, ?, ?, ?)`);
  months.slice(-12).forEach((m, i) => fin.run(opp, m, 1_300_00 + i * 20_00, 1_000_00 + i * 15_00, 110_000 + i * 1_500, i >= 6 ? 1 : 0));
  db.prepare(`INSERT INTO opportunities (name, category, stage, asking_price, business_model) VALUES ('Chrome extension for recruiters', 'saas', 'researching', 18_000_00, 'Freemium extension')`).run();

  db.prepare(`INSERT INTO notes (title, kind, body, tags, asset_id) VALUES ('Why we bought Ledgerly', 'thesis', 'Low churn, underpriced, founder burnt out. Plan: annual plans + SEO.', 'saas, thesis', ?)`).run(a1);
  db.prepare(`INSERT INTO notes (title, kind, body, tags) VALUES ('Never buy without 12 months of verified P&L', 'lesson', 'Two near-misses this year came from unverified screenshots.', 'diligence')`).run();
})();
console.log(`Seeded demo data into ${dir}`);
store.db.close();
