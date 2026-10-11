// Minimal RFC 4180 CSV reader/writer plus transaction import validation.
import { TXN_CATEGORIES, type TxnCategory } from './domain';
import { parseFlexibleDate } from './dates';
import { parseMoney } from './money';

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

function escapeField(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Guard against spreadsheet formula injection when the file is opened in Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(escapeField).join(',')).join('\r\n') + '\r\n';
}

export const TXN_CSV_HEADER = ['date', 'asset', 'category', 'amount', 'description', 'counterparty', 'notes'];

const normalise = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const CATEGORY_LOOKUP = new Map<string, TxnCategory>();
for (const [key, meta] of Object.entries(TXN_CATEGORIES) as [TxnCategory, { label: string }][]) {
  CATEGORY_LOOKUP.set(normalise(key), key);
  CATEGORY_LOOKUP.set(normalise(meta.label), key);
}
// Common synonyms
for (const [alias, key] of [
  ['income', 'revenue'], ['sales', 'revenue'], ['hosting', 'hosting'], ['infrastructure', 'hosting'],
  ['subscriptions', 'software'], ['software', 'software'], ['ads', 'marketing'], ['advertising', 'marketing'],
  ['dev', 'development'], ['fees', 'payment_fees'], ['stripe fees', 'payment_fees'], ['other', 'other_opex'],
  ['expense', 'other_opex'], ['investment', 'investment'], ['acquisition', 'acquisition_cost'],
  ['contribution', 'owner_contribution'], ['capital contribution', 'owner_contribution'],
  ['distribution', 'owner_distribution'], ['drawing', 'owner_distribution'],
] as [string, TxnCategory][]) CATEGORY_LOOKUP.set(normalise(alias), key);

export function matchCategory(input: string): TxnCategory | null {
  return CATEGORY_LOOKUP.get(normalise(input)) ?? null;
}

export interface ImportRow {
  line: number;
  date: string | null;
  asset_id: number | null;
  assetName: string;
  category: TxnCategory | null;
  amount: number | null;
  description: string | null;
  counterparty: string | null;
  notes: string | null;
  errors: string[];
  fingerprint: string | null;
  duplicate: 'existing' | 'file' | null;
}

export function txnFingerprint(t: { date: string; amount: number; category: string; asset_id: number | null; description: string | null }): string {
  return [t.date, t.amount, t.category, t.asset_id ?? '', normalise(t.description ?? '')].join('|');
}

/**
 * Parse and validate a transaction CSV. Expected headers (case-insensitive, any order):
 * date, amount, category, and optionally asset, description, counterparty, notes.
 * Negative amounts are accepted for expense categories and stored as positive values.
 */
export function validateTxnCsv(
  csv: string,
  assets: { id: number; name: string }[],
  existingFingerprints: Set<string>,
): { rows: ImportRow[]; headerErrors: string[] } {
  const table = parseCsv(csv);
  if (!table.length) return { rows: [], headerErrors: ['The file is empty.'] };
  const header = table[0].map((h) => normalise(h));
  const col = (name: string, ...alts: string[]) => {
    for (const n of [name, ...alts]) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const idx = {
    date: col('date', 'transaction date'),
    amount: col('amount', 'value'),
    category: col('category', 'type'),
    asset: col('asset', 'business', 'asset name'),
    description: col('description', 'memo', 'details'),
    counterparty: col('counterparty', 'payee', 'vendor', 'customer'),
    notes: col('notes', 'note'),
  };
  const headerErrors = (['date', 'amount', 'category'] as const)
    .filter((k) => idx[k] < 0)
    .map((k) => `Missing required column "${k}".`);
  if (headerErrors.length) return { rows: [], headerErrors };

  const assetByName = new Map(assets.map((a) => [normalise(a.name), a.id]));
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const get = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '');
    const errors: string[] = [];
    const rawDate = get(idx.date);
    const date = parseFlexibleDate(rawDate);
    if (!date) errors.push(`Invalid date "${rawDate}"`);
    const rawCat = get(idx.category);
    const category = matchCategory(rawCat);
    if (!category) errors.push(`Unknown category "${rawCat}"`);
    const rawAmount = get(idx.amount);
    let amount = parseMoney(rawAmount);
    if (amount === null) errors.push(`Invalid amount "${rawAmount}"`);
    else if (amount === 0) errors.push('Amount is zero');
    else if (amount < 0) {
      if (category && TXN_CATEGORIES[category].class === 'revenue') errors.push('Negative revenue (record refunds as an expense or adjust the original entry)');
      amount = Math.abs(amount);
    }
    const assetName = get(idx.asset);
    let asset_id: number | null = null;
    if (assetName && !/^(holding|holdco|holding company|-)$/i.test(assetName)) {
      asset_id = assetByName.get(normalise(assetName)) ?? null;
      if (asset_id === null) errors.push(`Unknown asset "${assetName}"`);
    }
    const description = get(idx.description) || null;
    const row: ImportRow = {
      line: r + 1,
      date,
      asset_id,
      assetName,
      category,
      amount,
      description,
      counterparty: get(idx.counterparty) || null,
      notes: get(idx.notes) || null,
      errors,
      fingerprint: null,
      duplicate: null,
    };
    if (!errors.length && date && category && amount !== null) {
      const fp = txnFingerprint({ date, amount, category, asset_id, description });
      row.fingerprint = fp;
      if (existingFingerprints.has(fp)) row.duplicate = 'existing';
      else if (seen.has(fp)) row.duplicate = 'file';
      seen.add(fp);
    }
    rows.push(row);
  }
  return { rows, headerErrors: [] };
}
