import { describe, expect, it } from 'vitest';
import type { Trip } from '../domain/trip';
import {
  binTrips,
  categoryShares,
  consumptionByMonthOfYear,
  dailyTotals,
  drivingRecords,
  drivingStats,
  lengthBins,
  longestStreak,
  rampClasses,
  speedBins,
  tripSpeed,
  weekdayHourGrid,
} from './driving';

let counter = 0;
function trip(start: string, minutes: number, distanceKm: number, energyKwh: number | null, category = 'Private'): Trip {
  const [date, time] = start.split('T');
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const end = `${date}T${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  return {
    id: String(counter++),
    start,
    end,
    startAddress: '',
    endAddress: '',
    distanceKm,
    energyKwh,
    category,
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startOdometerKm: null,
    endOdometerKm: null,
    tripType: 'SINGLE',
    socStart: null,
    socEnd: null,
    comment: '',
  };
}

describe('tripSpeed', () => {
  it('divides distance by duration and rejects zero durations', () => {
    expect(tripSpeed(trip('2026-01-05T08:00', 30, 30, 5))).toBeCloseTo(60);
    expect(tripSpeed(trip('2026-01-05T08:00', 0, 3, 1))).toBeNull();
  });
});

describe('drivingStats', () => {
  it('computes the headline figures', () => {
    const trips = [
      trip('2026-01-05T08:00', 10, 4, 1),
      trip('2026-01-05T17:00', 10, 4, 1),
      trip('2026-01-06T09:00', 60, 60, 10),
      trip('2026-01-09T09:00', 20, 10, 2),
    ];
    const s = drivingStats(trips);
    expect(s.trips).toBe(4);
    expect(s.activeDays).toBe(3);
    expect(s.tripsPerActiveDay).toBeCloseTo(4 / 3);
    expect(s.averageKm).toBe(19.5);
    expect(s.medianKm).toBe(7);
    expect(s.shortShare).toBe(0.5);
    expect(s.longestTrip?.distanceKm).toBe(60);
    expect(s.busiestDay).toMatchObject({ date: '2026-01-05', trips: 2 });
    expect(s.averageSpeed).toBeCloseTo(78 / (100 / 60));
  });

  it('handles no trips', () => {
    expect(drivingStats([])).toMatchObject({ trips: 0, tripsPerActiveDay: null, medianKm: null, longestTrip: null, busiestDay: null });
  });
});

describe('weekdayHourGrid', () => {
  it('puts Monday first and counts the start hour', () => {
    // 2026-01-05 is a Monday, 2026-01-11 a Sunday.
    const grid = weekdayHourGrid([trip('2026-01-05T08:15', 5, 3, 1), trip('2026-01-05T08:45', 5, 4, 1), trip('2026-01-11T23:30', 5, 7, 1)]);
    expect(grid.count[0][8]).toBe(2);
    expect(grid.distanceKm[0][8]).toBe(7);
    expect(grid.count[6][23]).toBe(1);
    expect(grid.count.flat().reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe('binTrips', () => {
  it('uses half-open classes and weights consumption by distance', () => {
    const trips = [
      // 1 km at 50 kWh/100 km and 4 km at 10 kWh/100 km: mean of ratios 30, weighted 18.
      trip('2026-01-05T08:00', 5, 1, 0.5),
      trip('2026-01-05T09:00', 5, 4, 0.4),
      trip('2026-01-05T10:00', 5, 5, 1),
    ];
    const bins = binTrips(trips, [0, 5, Infinity], (t) => t.distanceKm, 1);
    expect(bins[0]).toMatchObject({ trips: 2, samples: 2, distanceKm: 5 });
    expect(bins[0].consumption).toBeCloseTo(18);
    expect(bins[1]).toMatchObject({ trips: 1, distanceKm: 5 });
    expect(bins[1].consumption).toBeCloseTo(20);
  });

  it('hides bins with too few samples but keeps counts', () => {
    const bins = lengthBins([trip('2026-01-05T08:00', 5, 1, 0.3), trip('2026-01-05T09:00', 5, 1, null)]);
    expect(bins[0]).toMatchObject({ trips: 2, samples: 1, consumption: null, q1: null });
  });

  it('computes quartiles of the per-trip ratio', () => {
    const trips = [10, 20, 30, 40, 50].map((c, i) => trip(`2026-01-0${i + 1}T08:00`, 10, 10, c / 10));
    const [bin] = binTrips(trips, [0, Infinity], (t) => t.distanceKm);
    expect(bin).toMatchObject({ q1: 20, median: 30, q3: 40 });
  });

  it('bins speed and skips trips without a duration', () => {
    const trips = [trip('2026-01-05T08:00', 60, 40, 8), trip('2026-01-05T10:00', 0, 2, 1)];
    const bins = speedBins(trips);
    expect(bins.find((b) => b.from === 30)?.trips).toBe(1);
    expect(bins.reduce((s, b) => s + b.trips, 0)).toBe(1);
  });
});

describe('consumptionByMonthOfYear', () => {
  it('pools the same month across years and hides thin months', () => {
    const trips = [
      ...[1, 2, 3].map((d) => trip(`2025-02-0${d}T08:00`, 10, 10, 3)),
      ...[1, 2].map((d) => trip(`2026-02-0${d}T08:00`, 10, 10, 2)),
      trip('2026-07-01T08:00', 10, 10, 2),
    ];
    const months = consumptionByMonthOfYear(trips);
    expect(months).toHaveLength(12);
    expect(months[1].samples).toBe(5);
    expect(months[1].consumption).toBeCloseTo(26);
    expect(months[6]).toMatchObject({ trips: 1, consumption: null });
  });
});

describe('streaks and records', () => {
  it('finds the longest run of consecutive days, across month ends', () => {
    const days = ['2026-01-01', '2026-01-30', '2026-01-31', '2026-02-01', '2026-02-03'].map((date) => ({ date }));
    expect(longestStreak(days)).toEqual({ days: 3, from: '2026-01-30', to: '2026-02-01' });
    expect(longestStreak([])).toBeNull();
  });

  it('collects the records and ignores short trips for efficiency', () => {
    const trips = [
      trip('2026-01-05T08:00', 5, 2, 2), // absurd ratio, but below the 10 km threshold
      trip('2026-01-05T09:00', 30, 30, 4.5),
      trip('2026-01-06T09:00', 25, 50, 15),
      trip('2026-01-06T12:00', 60, 40, 8),
    ];
    const r = drivingRecords(trips);
    expect(r.longestTrip?.distanceKm).toBe(50);
    expect(r.longestDay).toMatchObject({ date: '2026-01-06', distanceKm: 90 });
    expect(r.mostEfficientTrip?.distanceKm).toBe(30);
    expect(r.leastEfficientTrip?.distanceKm).toBe(50);
    expect(r.fastestTrip?.distanceKm).toBe(50);
    expect(r.mostTripsDay?.trips).toBe(2);
    expect(r.streak?.days).toBe(2);
  });
});

describe('dailyTotals', () => {
  it('groups by start day', () => {
    const d = dailyTotals([trip('2026-01-06T09:00', 5, 5, 1), trip('2026-01-05T09:00', 5, 3, 1), trip('2026-01-05T19:00', 5, 4, 1)]);
    expect(d).toEqual([
      { date: '2026-01-05', trips: 2, distanceKm: 7 },
      { date: '2026-01-06', trips: 1, distanceKm: 5 },
    ]);
  });
});

describe('categoryShares', () => {
  it('folds categories beyond the limit into one row', () => {
    const trips = [trip('2026-01-05T08:00', 5, 50, 1, 'A'), trip('2026-01-05T09:00', 5, 30, 1, 'B'), trip('2026-01-05T10:00', 5, 10, 1, 'C'), trip('2026-01-05T11:00', 5, 6, 1, 'D'), trip('2026-01-05T12:00', 5, 4, 1, 'E')];
    const rows = categoryShares(trips, 3);
    expect(rows.map((r) => r.category)).toEqual(['A', 'B', 'C', '']);
    expect(rows[3]).toMatchObject({ isOther: true, trips: 2, distanceKm: 10 });
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1);
  });
});

describe('rampClasses', () => {
  it('maps zero to 0 and spreads positives over 1..5', () => {
    const cls = rampClasses([0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(cls(0)).toBe(0);
    expect(cls(1)).toBe(1);
    expect(cls(10)).toBe(5);
  });
});
