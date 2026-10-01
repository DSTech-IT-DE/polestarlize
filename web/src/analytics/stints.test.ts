import { describe, expect, it } from 'vitest';
import { generateDemoTrips } from '../lib/demoData';
import { trip } from './stintsFixtures';
import { buildStints, distanceMeters, shortAddress } from './stints';

describe('buildStints', () => {
  it('derives SOC change and parking time between consecutive trips', () => {
    const a = trip({ start: '2026-01-01T08:00', end: '2026-01-01T08:30', socStart: 60, socEnd: 50, startOdometerKm: 100 });
    const b = trip({ start: '2026-01-01T18:30', end: '2026-01-01T19:00', socStart: 80, socEnd: 70, startOdometerKm: 110 });
    const [s] = buildStints([b, a]);
    expect(s).toMatchObject({ socBefore: 50, socAfter: 80, delta: 30, parkedMinutes: 600, odometerGap: false });
  });

  it('flags odometer gaps but tolerates 1 km', () => {
    const a = trip({ start: '2026-01-01T08:00', end: '2026-01-01T08:30', startOdometerKm: 100 }); // ends at 110
    const near = trip({ start: '2026-01-01T10:00', end: '2026-01-01T10:10', startOdometerKm: 111 });
    const far = trip({ start: '2026-01-01T12:00', end: '2026-01-01T12:10', startOdometerKm: 150 });
    expect(buildStints([a, near])[0].odometerGap).toBe(false);
    const gap = buildStints([a, far])[0];
    expect(gap.odometerGap).toBe(true);
    expect(gap.missingKm).toBe(40);
  });

  it('skips pairs without SOC or with overlapping times', () => {
    const a = trip({ start: '2026-01-01T08:00', end: '2026-01-01T09:00' });
    const noSoc = trip({ start: '2026-01-01T10:00', end: '2026-01-01T10:10', socStart: null });
    const overlap = trip({ start: '2026-01-01T08:30', end: '2026-01-01T08:40' });
    expect(buildStints([a, noSoc])).toHaveLength(0);
    expect(buildStints([a, overlap])).toHaveLength(0);
  });

  it('yields one stint fewer than trips for contiguous demo data', () => {
    const trips = generateDemoTrips({ endDate: new Date(2026, 5, 30), days: 60 });
    const stints = buildStints(trips);
    expect(stints).toHaveLength(trips.length - 1);
    expect(stints.some((s) => s.odometerGap)).toBe(false);
  });
});

describe('helpers', () => {
  it('measures distances in metres', () => {
    expect(distanceMeters(50, 10, 50, 10)).toBe(0);
    expect(distanceMeters(50, 10, 50.001, 10)).toBeGreaterThan(105);
    expect(distanceMeters(50, 10, 50.001, 10)).toBeLessThan(115);
  });

  it('shortens addresses', () => {
    expect(shortAddress('Street 1, 12345 Town, Germany')).toBe('Street 1, Town');
    expect(shortAddress('Somewhere')).toBe('Somewhere');
    expect(shortAddress('')).toBe('');
  });
});
