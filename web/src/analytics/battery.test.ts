import { describe, expect, it } from 'vitest';
import { generateDemoTrips } from '../lib/demoData';
import {
  capacitySamples,
  capacityTrend,
  estimateCapacity,
  monthlyCapacity,
  recentCapacity,
  socUsage,
  stateOfHealth,
  type MonthlyCapacity,
} from './battery';
import { trip } from './stintsFixtures';

describe('capacitySamples', () => {
  it('keeps only trips with energy and a large enough SOC drop', () => {
    const trips = [
      trip({ start: '2026-01-01T08:00', end: '2026-01-01T09:00', energyKwh: 8, socStart: 80, socEnd: 70 }),
      trip({ start: '2026-01-02T08:00', end: '2026-01-02T09:00', energyKwh: 1, socStart: 80, socEnd: 78 }),
      trip({ start: '2026-01-03T08:00', end: '2026-01-03T09:00', energyKwh: null, socStart: 80, socEnd: 60 }),
      trip({ start: '2026-01-04T08:00', end: '2026-01-04T09:00', energyKwh: 3, socStart: 50, socEnd: 60 }),
    ];
    const s = capacitySamples(trips);
    expect(s).toHaveLength(1);
    expect(s[0].capacityKwh).toBeCloseTo(80);
  });
});

describe('estimateCapacity', () => {
  it('uses the energy-weighted ratio, not the mean of ratios', () => {
    const samples = capacitySamples([
      trip({ start: '2026-01-01T08:00', end: '2026-01-01T09:00', energyKwh: 8, socStart: 80, socEnd: 70 }), // 80
      trip({ start: '2026-01-02T08:00', end: '2026-01-02T09:00', energyKwh: 4.8, socStart: 80, socEnd: 74 }), // 80
      trip({ start: '2026-01-03T08:00', end: '2026-01-03T09:00', energyKwh: 24, socStart: 80, socEnd: 50 }), // 80
    ]);
    const est = estimateCapacity(samples)!;
    expect(est.capacityKwh).toBeCloseTo(80);
    expect(est.low).toBeCloseTo(80);
    expect(est.high).toBeCloseTo(80);
    expect(est.sumDeltaSoc).toBe(46);
  });

  it('widens the band when per-trip ratios scatter', () => {
    const scattered = capacitySamples([
      trip({ start: '2026-01-01T08:00', end: '2026-01-01T09:00', energyKwh: 7, socStart: 80, socEnd: 70 }),
      trip({ start: '2026-01-02T08:00', end: '2026-01-02T09:00', energyKwh: 9, socStart: 80, socEnd: 70 }),
      trip({ start: '2026-01-03T08:00', end: '2026-01-03T09:00', energyKwh: 8, socStart: 80, socEnd: 70 }),
    ]);
    const est = estimateCapacity(scattered)!;
    expect(est.capacityKwh).toBeCloseTo(80);
    expect(est.high - est.low).toBeGreaterThan(5);
  });

  it('returns null without samples', () => {
    expect(estimateCapacity([])).toBeNull();
  });
});

describe('with demo data (nominal 79 kWh, 2 %/year fade)', () => {
  const trips = generateDemoTrips({ endDate: new Date(2026, 8, 30), days: 730 });
  const samples = capacitySamples(trips);

  it('lands near the nominal capacity', () => {
    const recent = recentCapacity(samples)!;
    expect(recent).not.toBeNull();
    expect(recent.capacityKwh).toBeGreaterThan(73);
    expect(recent.capacityKwh).toBeLessThan(82);
    expect(recent.high).toBeGreaterThan(recent.low);
  });

  it('keeps monthly estimates in a plausible range', () => {
    const months = monthlyCapacity(samples);
    expect(months.length).toBeGreaterThan(5);
    for (const m of months) {
      expect(m.capacityKwh).toBeGreaterThan(65);
      expect(m.capacityKwh).toBeLessThan(90);
    }
  });

  it('skips thin months', () => {
    const months = monthlyCapacity(samples, 10_000);
    expect(months).toHaveLength(0);
  });
});

describe('capacityTrend on a synthetic fade', () => {
  // Two years of weekly 40-point discharges; true capacity fades by 2 % per year from 79 kWh.
  const trips = Array.from({ length: 104 }, (_, week) => {
    const date = new Date(2024, 0, 1 + week * 7);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const capacity = 79 * (1 - 0.02 * (week / 52));
    const socStart = 80;
    // The car reports integer SOC, so the end value is rounded like in real exports.
    const drop = 40 + (week % 3) - 1;
    const energyKwh = (drop * capacity) / 100;
    return trip({ start: `${day}T08:00`, end: `${day}T09:00`, energyKwh, socStart, socEnd: socStart - Math.round(drop) });
  });
  const months = monthlyCapacity(capacitySamples(trips));

  it('estimates close to the true capacity and finds the fade', () => {
    expect(months.length).toBe(24);
    const recent = recentCapacity(capacitySamples(trips))!;
    expect(recent.capacityKwh).toBeGreaterThan(75);
    expect(recent.capacityKwh).toBeLessThan(77);
    const trend = capacityTrend(months)!;
    expect(trend.kwhPerYear).toBeLessThan(0);
    expect(trend.kwhPerYear).toBeGreaterThan(-2.5);
    expect(trend.percentPerYear).toBeCloseTo(-2, 0);
    expect(trend.significant).toBe(true);
  });
});

describe('capacityTrend', () => {
  const month = (key: string, capacityKwh: number, sumDeltaSoc = 100): MonthlyCapacity => ({ key, capacityKwh, low: capacityKwh - 1, high: capacityKwh + 1, n: 10, sumDeltaSoc });

  it('needs at least four months spanning three months', () => {
    expect(capacityTrend([month('2026-01', 80), month('2026-02', 80), month('2026-03', 79)])).toBeNull();
    expect(capacityTrend([month('2026-01', 80), month('2026-02', 80), month('2026-03', 79), month('2026-04', 79)])).not.toBeNull();
    // Four months but only spanning two: impossible by construction, three months gap is the minimum.
    expect(capacityTrend([month('2026-01', 80), month('2026-01', 80), month('2026-02', 79), month('2026-03', 79)])).toBeNull();
  });

  it('recovers a linear slope per year', () => {
    const months = Array.from({ length: 12 }, (_, i) => month(`2026-${String(i + 1).padStart(2, '0')}`, 80 - i * 0.1));
    const trend = capacityTrend(months)!;
    expect(trend.kwhPerYear).toBeCloseTo(-1.2, 5);
    expect(trend.percentPerYear).toBeCloseTo((-1.2 / 79.45) * 100, 1);
    expect(trend.significant).toBe(true);
    expect(trend.line.from.kwh).toBeCloseTo(80);
  });

  it('is not significant for noise', () => {
    const noise = [80, 81, 79, 80.5, 79.5, 80.2];
    const months = noise.map((v, i) => month(`2026-0${i + 1}`, v));
    expect(capacityTrend(months)!.significant).toBe(false);
  });
});

describe('recentCapacity', () => {
  it('falls back to all data when the window is too thin', () => {
    const old = capacitySamples([
      trip({ start: '2025-01-01T08:00', end: '2025-01-01T09:00', energyKwh: 24, socStart: 80, socEnd: 50 }),
      trip({ start: '2025-01-02T08:00', end: '2025-01-02T09:00', energyKwh: 16, socStart: 80, socEnd: 60 }),
      trip({ start: '2026-01-02T08:00', end: '2026-01-02T09:00', energyKwh: 8, socStart: 80, socEnd: 70 }),
    ]);
    const r = recentCapacity(old)!;
    expect(r.windowDays).toBeNull();
    expect(r.n).toBe(3);
  });

  it('is null without enough discharge at all', () => {
    const few = capacitySamples([trip({ start: '2026-01-02T08:00', end: '2026-01-02T09:00', energyKwh: 8, socStart: 80, socEnd: 70 })]);
    expect(recentCapacity(few)).toBeNull();
  });
});

describe('stateOfHealth', () => {
  it('is the ratio to the nominal capacity', () => {
    expect(stateOfHealth(76, 80)).toBeCloseTo(0.95);
    expect(stateOfHealth(76, 0)).toBeNull();
  });
});

describe('socUsage', () => {
  it('summarises how the battery is used', () => {
    const trips = [
      trip({ start: '2026-01-01T08:00', end: '2026-01-01T09:00', energyKwh: 8, socStart: 95, socEnd: 85 }),
      trip({ start: '2026-01-01T17:00', end: '2026-01-01T18:00', energyKwh: 8, socStart: 85, socEnd: 15 }),
      trip({ start: '2026-01-02T08:00', end: '2026-01-02T09:00', energyKwh: 7.9, socStart: 60, socEnd: 50 }),
      trip({ start: '2026-01-03T08:00', end: '2026-01-03T09:00', energyKwh: null, socStart: null, socEnd: null }),
    ];
    const u = socUsage(trips, 79);
    expect(u.trips).toBe(3);
    expect(u.shareStartAtLeast90).toBeCloseTo(1 / 3);
    expect(u.shareEndAtMost20).toBeCloseTo(1 / 3);
    expect(u.minSoc).toBe(15);
    expect(u.days).toBe(2);
    expect(u.medianDayStart).toBe((95 + 60) / 2);
    expect(u.medianDayEnd).toBe((15 + 50) / 2);
    expect(u.energyKwh).toBeCloseTo(23.9);
    expect(u.equivalentCycles).toBeCloseTo(23.9 / 79);
    expect(u.startHistogram.reduce((a, b) => a + b, 0)).toBe(3);
    expect(u.startHistogram[19]).toBe(1);
    expect(u.endHistogram[3]).toBe(1);
  });

  it('handles empty input', () => {
    expect(socUsage([], 79)).toMatchObject({ trips: 0, shareStartAtLeast90: null, minSoc: null, medianDayStart: null });
  });
});
