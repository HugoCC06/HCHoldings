import { describe, expect, it } from 'vitest';
import { formatMoney, minorToInput, parseMoney } from '../shared/money';
import { addMonths, monthRange, parseFlexibleDate } from '../shared/dates';
import { parseCsv, toCsv, validateTxnCsv } from '../shared/csv';

describe('money', () => {
  it.each([
    ['1,234.56', 123456], ['£99', 9900], ['-12.5', -1250], ['(40.00)', -4000], ['0.07', 7], ['.5', 50], ['  10  ', 1000],
  ])('parses %s', (input, expected) => expect(parseMoney(input)).toBe(expected));
  it.each(['abc', '1.234', '', '1e5', '--1'])('rejects %s', (input) => expect(parseMoney(input)).toBeNull());
  it('round-trips through input formatting', () => {
    for (const v of [0, 5, 100, 123456, -999]) expect(parseMoney(minorToInput(v))).toBe(v);
  });
  it('formats currency', () => {
    expect(formatMoney(123456, 'GBP')).toBe('£1,234.56');
    expect(formatMoney(null)).toBe('—');
  });
});

describe('dates', () => {
  it('parses UK and ISO formats, rejects impossible dates', () => {
    expect(parseFlexibleDate('2026-02-03')).toBe('2026-02-03');
    expect(parseFlexibleDate('03/02/2026')).toBe('2026-02-03');
    expect(parseFlexibleDate('31/02/2026')).toBeNull();
    expect(parseFlexibleDate('2026-13-01')).toBeNull();
  });
  it('month arithmetic crosses years', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2025-11', 14)).toBe('2027-01');
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('csv', () => {
  it('handles quotes, commas and newlines', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\r\n"multi\nline",2')).toEqual([['a', 'b'], ['x, y', 'he said "hi"'], ['multi\nline', '2']]);
  });
  it('escapes output and neutralises formulas', () => {
    expect(toCsv(['a'], [['=SUM(A1)'], ['x,y'], [-5]])).toBe('a\r\n\'=SUM(A1)\r\n"x,y"\r\n-5\r\n');
  });

  const assets = [{ id: 7, name: 'Acme SaaS' }];
  it('validates rows and reports errors with line numbers', () => {
    const csv = 'Date,Asset,Category,Amount,Description\n2026-01-02,Acme SaaS,Revenue,100.00,Stripe payout\n31/13/2026,Acme SaaS,Revenue,1,x\n2026-01-03,Unknown,Hosting,5,y\n2026-01-04,,hosting,-12.50,AWS\n2026-01-05,Acme SaaS,Revenue,-3,refund';
    const { rows, headerErrors } = validateTxnCsv(csv, assets, new Set());
    expect(headerErrors).toEqual([]);
    expect(rows[0]).toMatchObject({ line: 2, date: '2026-01-02', asset_id: 7, category: 'revenue', amount: 10000, errors: [] });
    expect(rows[1].errors[0]).toMatch(/Invalid date/);
    expect(rows[2].errors[0]).toMatch(/Unknown asset/);
    expect(rows[3]).toMatchObject({ asset_id: null, category: 'hosting', amount: 1250, errors: [] });
    expect(rows[4].errors[0]).toMatch(/Negative revenue/);
  });
  it('flags duplicates against existing data and within the file', () => {
    const csv = 'date,category,amount,asset,description\n2026-01-02,revenue,10,Acme SaaS,Sale\n2026-01-02,revenue,10,Acme SaaS,sale\n2026-01-03,revenue,10,Acme SaaS,Sale';
    const first = validateTxnCsv(csv, assets, new Set());
    expect(first.rows.map((r) => r.duplicate)).toEqual([null, 'file', null]);
    const second = validateTxnCsv(csv, assets, new Set([first.rows[0].fingerprint!]));
    expect(second.rows[0].duplicate).toBe('existing');
  });
  it('requires core columns', () => {
    expect(validateTxnCsv('foo,bar\n1,2', assets, new Set()).headerErrors).toHaveLength(3);
  });
});
