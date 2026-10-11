import { describe, expect, it } from 'vitest';
import {
  capitalInvestedInAsset, cashPosition, concentration, growth, lastCompleteMonth, latestValuation, margin, monthlyTotals,
  portfolioSeries, portfolioValue, roic, sumTotals, totalCapitalInvested, windowTotals, type TxnLite,
} from '../shared/finance';

const t = (date: string, category: TxnLite['category'], amount: number, asset_id: number | null = 1): TxnLite => ({ date, category, amount, asset_id });

describe('totals', () => {
  const txns = [
    t('2026-01-05', 'revenue', 100_00),
    t('2026-01-10', 'hosting', 20_00),
    t('2026-01-11', 'payment_fees', 3_00),
    t('2026-01-12', 'investment', 500_00),
    t('2026-01-13', 'owner_contribution', 1000_00, null),
    t('2026-01-14', 'owner_distribution', 50_00, null),
  ];
  it('keeps revenue, expenses, capital and owner flows separate', () => {
    const s = sumTotals(txns);
    expect(s.revenue).toBe(100_00);
    expect(s.opex).toBe(23_00);
    expect(s.profit).toBe(77_00);
    expect(s.capital).toBe(500_00);
    expect(s.ownerIn).toBe(1000_00);
    expect(s.ownerOut).toBe(50_00);
    expect(s.netCashFlow).toBe(100_00 - 23_00 - 500_00 + 1000_00 - 50_00);
    expect(s.opexByCategory).toEqual({ hosting: 20_00, payment_fees: 3_00 });
  });
  it('capital and owner transactions never affect operating profit', () => {
    const s = sumTotals([t('2026-01-01', 'acquisition_cost', 999_00), t('2026-01-01', 'owner_contribution', 5_00)]);
    expect(s.profit).toBe(0);
  });
  it('buckets by month and fills empty months', () => {
    const m = monthlyTotals([...txns, t('2026-03-01', 'revenue', 7_00)], ['2026-01', '2026-02', '2026-03']);
    expect(m.map((x) => x.revenue)).toEqual([100_00, 0, 7_00]);
    expect(m[1].count).toBe(0);
  });
  it('ignores transactions outside the requested months', () => {
    expect(monthlyTotals([t('2025-12-31', 'revenue', 1)], ['2026-01'])[0].revenue).toBe(0);
  });
});

describe('ratios', () => {
  it('margin is null without revenue', () => {
    expect(margin(0, -10)).toBeNull();
    expect(margin(200, 50)).toBe(0.25);
  });
  it('growth handles zero and negative bases', () => {
    expect(growth(120, 100)).toBeCloseTo(0.2);
    expect(growth(100, 0)).toBeNull();
    expect(growth(-50, -100)).toBeCloseTo(0.5); // loss halved = improvement
  });
  it('last complete month', () => {
    expect(lastCompleteMonth('2026-10-11')).toBe('2026-09');
    expect(lastCompleteMonth('2026-01-01')).toBe('2025-12');
  });
});

describe('trailing window and ROIC', () => {
  it('counts only months since first activity', () => {
    const w = windowTotals([t('2026-07-01', 'revenue', 300_00), t('2026-09-01', 'hosting', 30_00)], '2026-09');
    expect(w.monthsCovered).toBe(3);
    expect(w.profit).toBe(270_00);
  });
  it('annualises ROIC when history is short and flags it', () => {
    const w = windowTotals([t('2026-07-01', 'revenue', 300_00)], '2026-09');
    const r = roic(w, 1200_00)!;
    expect(r.annualised).toBe(true);
    expect(r.profit).toBe(1200_00);
    expect(r.value).toBeCloseTo(1);
  });
  it('uses actual TTM when 12+ months exist', () => {
    const txns = Array.from({ length: 14 }, (_, i) => t(`${2025 + Math.floor((i + 7) / 12)}-${String(((i + 7) % 12) + 1).padStart(2, '0')}-01`, 'revenue', 100_00));
    const w = windowTotals(txns, '2026-09');
    expect(w.monthsCovered).toBe(12);
    expect(roic(w, 2400_00)).toMatchObject({ annualised: false, value: 0.5 });
  });
  it('is null without invested capital or data', () => {
    expect(roic(windowTotals([], '2026-09'), 100)).toBeNull();
    expect(roic(windowTotals([t('2026-09-01', 'revenue', 1)], '2026-09'), 0)).toBeNull();
  });
});

describe('capital invested', () => {
  const asset = { id: 1, status: 'operating', origin: 'acquired', start_date: '2026-03-01', acquisition_price: 10_000_00 };
  const txns = [t('2026-04-01', 'investment', 500_00), t('2026-04-02', 'hosting', 10_00), t('2026-05-01', 'acquisition_cost', 200_00), t('2026-05-01', 'investment', 99_00, 2)];
  it('adds purchase price and capital transactions for the asset only', () => {
    expect(capitalInvestedInAsset(asset, txns)).toBe(10_700_00);
  });
  it('respects as-of date', () => {
    expect(capitalInvestedInAsset(asset, txns, '2026-02-28')).toBe(0);
    expect(capitalInvestedInAsset(asset, txns, '2026-04-15')).toBe(10_500_00);
  });
  it('portfolio total includes holding-level and other asset capital', () => {
    expect(totalCapitalInvested([asset], txns)).toBe(10_799_00);
  });
});

describe('valuations', () => {
  const vals = [
    { id: 1, asset_id: 1, date: '2026-01-01', value: 100 },
    { id: 2, asset_id: 1, date: '2026-06-01', value: 300 },
    { id: 3, asset_id: 1, date: '2026-06-01', value: 350 },
    { id: 4, asset_id: 2, date: '2026-03-01', value: 50 },
  ];
  it('latest valuation wins, with later entry breaking ties', () => {
    expect(latestValuation(vals, 1)?.value).toBe(350);
    expect(latestValuation(vals, 1, '2026-05-31')?.value).toBe(100);
    expect(latestValuation(vals, 3)).toBeNull();
  });
  it('portfolio value sums latest per asset; null when nothing valued', () => {
    expect(portfolioValue(vals)).toEqual({ value: 400, assetsValued: 2 });
    expect(portfolioValue(vals, '2026-02-01')).toEqual({ value: 100, assetsValued: 1 });
    expect(portfolioValue([])).toBeNull();
  });
  it('portfolio series tracks value, invested and cumulative profit', () => {
    const s = portfolioSeries(
      [{ id: 1, status: 'operating', origin: 'built', start_date: null, acquisition_price: null }],
      [t('2025-12-15', 'revenue', 10), t('2026-01-15', 'revenue', 5), t('2026-02-15', 'investment', 7)],
      vals,
      ['2026-01', '2026-02'],
    );
    expect(s).toEqual([
      { month: '2026-01', value: 100, invested: 0, cumulativeProfit: 15 },
      { month: '2026-02', value: 100, invested: 7, cumulativeProfit: 15 },
    ]);
  });
});

describe('concentration & cash', () => {
  it('computes shares and HHI', () => {
    const c = concentration([t('2026-01-01', 'revenue', 75, 1), t('2026-01-01', 'revenue', 25, 2), t('2026-01-01', 'hosting', 999, 2)]);
    expect(c.topShare).toBe(0.75);
    expect(c.hhi).toBeCloseTo(0.625);
    expect(concentration([]).topShare).toBeNull();
  });
  it('cash position uses the latest balance per account', () => {
    const p = cashPosition(
      [
        { account_id: 1, date: '2026-01-01', balance: 100 },
        { account_id: 1, date: '2026-02-01', balance: 80 },
        { account_id: 2, date: '2026-01-15', balance: -20 },
      ],
      [1, 2, 3],
    )!;
    expect(p.total).toBe(60);
    expect(p.oldestDate).toBe('2026-01-15');
    expect(cashPosition([], [1])).toBeNull();
  });
});
