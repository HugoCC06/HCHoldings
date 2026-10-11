import { describe, expect, it } from 'vitest';
import { dcf, irr, maxPriceForYield, multipleValuation, returnAtPrice, ttmFromHistory } from '../shared/valuation';
import { assetPerformance, buildWarnings, goalActual, isOverdue, metricTrends, rankNextActions } from '../shared/insights';

describe('valuation', () => {
  it('multiple of profit', () => expect(multipleValuation(50_000_00, 3)).toBe(150_000_00));
  it('DCF with no growth and no discount equals sum of flows plus exit', () => {
    const r = dcf(100, { growthPct: 0, discountPct: 0, years: 3, exitMultiple: 2 });
    expect(r.pvFlows).toBe(300);
    expect(r.pvExit).toBe(200);
    expect(r.total).toBe(500);
  });
  it('DCF discounts future flows', () => {
    const r = dcf(1000, { growthPct: 10, discountPct: 10, years: 2, exitMultiple: 0 });
    // growth and discount cancel: each year PV = 1000
    expect(r.pvFlows).toBe(2000);
  });
  it('return at price', () => {
    expect(returnAtPrice(300, 100)).toEqual({ yield: 1 / 3, paybackYears: 3 });
    expect(returnAtPrice(0, 100).yield).toBeNull();
    expect(returnAtPrice(100, -5).paybackYears).toBeNull();
  });
  it('IRR solves NPV = 0', () => {
    // pay 100, receive 110 in one year (no exit) => 10%
    expect(irr(100, 110, { growthPct: 0, years: 1, exitMultiple: 0 })).toBeCloseTo(0.1, 6);
  });
  it('max price for target yield', () => {
    expect(maxPriceForYield(30_000_00, 25)).toBe(120_000_00);
    expect(maxPriceForYield(-1, 25)).toBeNull();
  });
  it('TTM from history uses the latest 12 periods and counts verified months', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ period: `2025-${String((i % 12) + 1).padStart(2, '0')}${i >= 12 ? 'x' : ''}`, revenue: 10, profit: 5, verified: i % 2 === 0 }));
    const r = ttmFromHistory(rows)!;
    expect(r.months).toBe(12);
    expect(r.profit).toBe(60);
    expect(ttmFromHistory([{ period: '2026-01', revenue: 10, profit: 4, verified: true }])!.annualisedProfit).toBe(48);
  });
});

describe('insights', () => {
  const today = '2026-10-11';
  type T = Parameters<typeof rankNextActions>[0][number];
  const task = (id: number, o: Partial<T>): T => ({ id, title: `T${id}`, status: 'next', priority: 'medium', deadline: null, asset_id: null, ...o });

  it('overdue only for open tasks with past deadlines', () => {
    expect(isOverdue({ status: 'next', deadline: '2026-10-10' }, today)).toBe(true);
    expect(isOverdue({ status: 'completed', deadline: '2026-10-10' }, today)).toBe(false);
    expect(isOverdue({ status: 'next', deadline: '2026-10-11' }, today)).toBe(false);
  });
  it('ranks overdue first, then priority', () => {
    const ranked = rankNextActions([
      task(1, { priority: 'critical' }),
      task(2, { priority: 'low', deadline: '2026-10-01' }),
      task(3, { priority: 'high', status: 'completed' }),
      task(4, { priority: 'medium', status: 'backlog' }),
    ], today);
    expect(ranked.map((t) => t.id)).toEqual([2, 1, 4]);
  });
  it('produces no warnings on an empty portfolio', () => {
    expect(buildWarnings({ today, assets: [], txns: [], tasks: [], milestones: [], balances: [], accountIds: [] })).toEqual([]);
  });
  it('warns on revenue drop and operating loss', () => {
    const w = buildWarnings({
      today,
      assets: [{ id: 1, name: 'Acme', status: 'operating', origin: 'built', start_date: null, acquisition_price: null }],
      txns: [
        { date: '2026-08-05', asset_id: 1, category: 'revenue', amount: 1000_00 },
        { date: '2026-09-05', asset_id: 1, category: 'revenue', amount: 500_00 },
        { date: '2026-09-06', asset_id: 1, category: 'development', amount: 900_00 },
      ],
      tasks: [], milestones: [], balances: [], accountIds: [],
    });
    expect(w.map((x) => x.title)).toEqual(expect.arrayContaining(['Operating loss last month', 'Acme: revenue down 50%']));
  });
  it('asset performance combines value, invested and profit', () => {
    const p = assetPerformance(
      { id: 1, status: 'operating', origin: 'acquired', start_date: '2026-01-01', acquisition_price: 1000_00 },
      [{ date: '2026-09-01', asset_id: 1, category: 'revenue', amount: 200_00 }, { date: '2026-08-01', asset_id: 1, category: 'revenue', amount: 100_00 }],
      [{ asset_id: 1, date: '2026-09-01', value: 1500_00 }],
      '2026-09',
    );
    expect(p.lastMonth.revenue).toBe(200_00);
    expect(p.revenueGrowth).toBe(1);
    expect(p.invested).toBe(1000_00);
    expect(p.totalGain).toBe(1500_00 + 300_00 - 1000_00);
    expect(p.roic?.annualised).toBe(true);
  });
  it('goal actuals by metric type', () => {
    const txns = [{ date: '2026-09-02', asset_id: 1, category: 'revenue' as const, amount: 500 }];
    const metrics = [{ asset_id: 1, name: 'Subscribers', date: '2026-09-01', value: 900 }, { asset_id: 1, name: 'subscribers', date: '2026-10-01', value: 1000 }];
    expect(goalActual({ asset_id: 1, metric: 'monthly_revenue', metric_name: null, target_value: 1000, manual_actual: null }, txns, metrics, '2026-09')).toBe(500);
    expect(goalActual({ asset_id: 1, metric: 'metric', metric_name: 'Subscribers', target_value: 1, manual_actual: null }, txns, metrics, '2026-09')).toBe(1000);
    expect(goalActual({ asset_id: 2, metric: 'monthly_profit', metric_name: null, target_value: 1, manual_actual: null }, txns, metrics, '2026-09')).toBeNull();
    expect(metricTrends(metrics, 1)).toEqual([{ name: 'subscribers', latest: 1000, date: '2026-10-01', previous: 900, change: expect.closeTo(1 / 9, 9) }]);
  });
});
