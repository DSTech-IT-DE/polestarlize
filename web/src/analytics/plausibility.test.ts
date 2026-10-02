import { describe, expect, it } from 'vitest';
import type { Trip } from '../domain/trip';
import { generateDemoTrips } from '../lib/demoData';
import { checkTrip, checkTrips, minimumConsumption, tripCheck } from './plausibility';

const options = { capacityKwh: 79 };

function trip(extra: Partial<Trip> = {}): Trip {
  return {
    id: 'x', start: '2026-03-01T08:00', end: '2026-03-01T09:00', startAddress: 'A', endAddress: 'B',
    distanceKm: 60, energyKwh: 11, category: 'Private', startLat: null, startLon: null, endLat: null, endLon: null,
    startOdometerKm: 1000, endOdometerKm: 1060, tripType: 'SINGLE', socStart: 80, socEnd: 66, comment: '', ...extra,
  };
}

describe('checkTrip', () => {
  it('accepts an ordinary trip', () => {
    expect(checkTrip(trip(), options)).toEqual([]);
  });

  it('flags a reported consumption below 10 kWh/100 km', () => {
    expect(checkTrip(trip({ energyKwh: 5.5 }), options)).toEqual(['low-consumption']);
    expect(checkTrip(trip({ energyKwh: 6.5 }), options)).toEqual([]);
  });

  it('ignores very short trips, where rounding dominates', () => {
    expect(checkTrip(trip({ distanceKm: 3, energyKwh: 0.1, endOdometerKm: 1003 }), options)).toEqual([]);
  });

  it('estimates the consumption from the SOC drop when no energy is reported', () => {
    // A recording that missed its end: 125 km over two days, 13 % used, no energy.
    const broken = trip({
      start: '2026-01-05T07:10', end: '2026-01-07T12:21', distanceKm: 125, energyKwh: null,
      startOdometerKm: 12000, endOdometerKm: 12125, socStart: 73, socEnd: 60,
    });
    expect(minimumConsumption(broken, options)).toEqual({ value: expect.closeTo(8.85, 2), source: 'soc' });
    expect(checkTrip(broken, options)).toEqual(['low-consumption', 'long-duration']);
    expect(checkTrip(trip({ energyKwh: null, socEnd: 70 }), options)).toEqual([]);
  });

  it('accepts long merged trips but not long single recordings', () => {
    const long = { start: '2026-03-01T08:00', end: '2026-03-02T20:00', distanceKm: 900, energyKwh: 170, endOdometerKm: 1900, socEnd: 20 };
    expect(checkTrip(trip({ ...long, tripType: 'MERGED' }), options)).toEqual([]);
    expect(checkTrip(trip(long), options)).toEqual(['long-duration']);
  });

  it('flags impossible speeds, odometer mismatches and charging while driving', () => {
    expect(checkTrip(trip({ end: '2026-03-01T08:10' }), options)).toEqual(['too-fast']);
    expect(checkTrip(trip({ endOdometerKm: 1200 }), options)).toEqual(['odometer-mismatch']);
    expect(checkTrip(trip({ endOdometerKm: 1062 }), options)).toEqual([]);
    expect(checkTrip(trip({ socEnd: 86 }), options)).toEqual(['soc-gain']);
  });
});

describe('tripCheck', () => {
  const suspicious = trip({ energyKwh: 2 });

  it('holds back suspicious trips until they are reviewed', () => {
    expect(tripCheck(suspicious, options).status).toBe('review');
    expect(tripCheck({ ...suspicious, review: 'include' }, options).status).toBe('ok');
    expect(tripCheck({ ...suspicious, review: 'exclude' }, options).status).toBe('excluded');
  });

  it('lets the user exclude any trip', () => {
    expect(tripCheck({ ...trip(), review: 'exclude' }, options)).toEqual({ issues: [], status: 'excluded' });
  });
});

describe('checkTrips', () => {
  it('splits counted trips from held back ones', () => {
    const a = trip({ id: 'a' });
    const b = trip({ id: 'b', energyKwh: 2 });
    const c = trip({ id: 'c', review: 'exclude' });
    const result = checkTrips([a, b, c], options);
    expect(result.counted.map((t) => t.id)).toEqual(['a']);
    expect(result.pendingReview).toBe(1);
    expect(result.excluded).toBe(1);
    expect(result.checks.get('b')?.issues).toEqual(['low-consumption']);
  });

  it('finds nothing to complain about in the demo data', () => {
    expect(checkTrips(generateDemoTrips(), options).pendingReview).toBe(0);
  });
});
