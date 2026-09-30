import { describe, expect, it } from 'vitest';
import { generateDemoTrips } from '../lib/demoData';
import { median, monthlyTotals, monthRange, totals } from './core';

describe('totals', () => {
  it('ignores trips without energy for the average consumption', () => {
    const base = generateDemoTrips({ endDate: new Date(2026, 0, 31), days: 10 });
    const withGap = [...base, { ...base[0], id: 'x', distanceKm: 100, energyKwh: null }];
    const a = totals(base);
    const b = totals(withGap);
    expect(b.distanceKm).toBeCloseTo(a.distanceKm + 100);
    expect(b.consumption).toBeCloseTo(a.consumption!);
  });

  it('handles empty input', () => {
    expect(totals([])).toMatchObject({ trips: 0, consumption: null, spanDays: 0 });
  });
});

describe('monthly helpers', () => {
  it('fills month gaps', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    const trips = generateDemoTrips({ endDate: new Date(2026, 5, 30), days: 120 });
    const months = monthlyTotals(trips);
    expect(months.map((m) => m.key)).toEqual(monthRange(months[0].key, months[months.length - 1].key));
  });

  it('computes medians', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
