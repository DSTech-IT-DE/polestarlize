import { describe, expect, it } from 'vitest';
import type { Trip } from '../domain/trip';
import { combineIncoming, planMerge } from './merge';

function trip(start: string, end: string, odo: number, extra: Partial<Trip> = {}): Trip {
  return {
    id: `${start}|${odo}`, start, end, startAddress: 'A', endAddress: 'B', distanceKm: 5, energyKwh: 1, category: 'Private',
    startLat: null, startLon: null, endLat: null, endLon: null, startOdometerKm: odo, endOdometerKm: odo + 5,
    tripType: 'SINGLE', socStart: 50, socEnd: 49, comment: '', ...extra,
  };
}

describe('planMerge', () => {
  const a = trip('2026-01-01T08:00', '2026-01-01T08:20', 100);
  const b = trip('2026-01-01T12:00', '2026-01-01T12:20', 105);
  const c = trip('2026-01-02T08:00', '2026-01-02T08:20', 110);

  it('adds only new trips from an overlapping export', () => {
    const plan = planMerge([a, b], [b, c]);
    expect(plan.put.map((t) => t.id)).toEqual([c.id]);
    expect(plan.remove).toEqual([]);
    expect(plan.stats).toEqual({ added: 1, updated: 0, unchanged: 1, replaced: 0 });
  });

  it('updates trips that changed in the app', () => {
    const plan = planMerge([a], [{ ...a, category: 'Business' }]);
    expect(plan.stats.updated).toBe(1);
    expect(plan.put[0].category).toBe('Business');
  });

  it('replaces trips that were merged after an earlier export', () => {
    const merged = trip('2026-01-01T08:00', '2026-01-01T12:20', 100, { tripType: 'MERGED', distanceKm: 10 });
    const plan = planMerge([a, b, c], [merged, c]);
    expect(plan.remove).toEqual([b.id]);
    expect(plan.stats).toMatchObject({ updated: 1, replaced: 1, unchanged: 1 });
  });

  it('keeps trips outside of the export period', () => {
    const plan = planMerge([a, b], [c]);
    expect(plan.remove).toEqual([]);
  });

  it('lets later files win when combining', () => {
    const combined = combineIncoming([[a], [{ ...a, comment: 'x' }]]);
    expect(combined).toHaveLength(1);
    expect(combined[0].comment).toBe('x');
  });
});
