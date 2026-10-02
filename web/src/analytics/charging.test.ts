import { describe, expect, it } from 'vitest';
import { generateDemoTrips } from '../lib/demoData';
import { capacitySamples, recentCapacity } from './battery';
import {
  MIN_CHARGE_GAIN,
  chargingPlaces,
  placeKind,
  placePrice,
  priceMix,
  chargingSessions,
  chargingStats,
  energyBalance,
  histogram,
  monthlyCharging,
  standbyDrain,
} from './charging';
import type { SavedPlace } from '../lib/savedPlaces';
import { buildStints, type Stint } from './stints';
import { trip } from './stintsFixtures';

function stint(partial: Partial<Stint>): Stint {
  return {
    from: '2026-01-01T18:00',
    to: '2026-01-02T08:00',
    parkedMinutes: 840,
    address: 'Main Street 1, 12345 Town, Country',
    lat: 50,
    lon: 10,
    socBefore: 40,
    socAfter: 80,
    delta: 40,
    missingKm: 0,
    odometerGap: false,
    ...partial,
  };
}

describe('chargingSessions', () => {
  it('keeps clear gains without odometer gap and estimates the energy', () => {
    const stints = [
      stint({ delta: 40 }),
      stint({ delta: MIN_CHARGE_GAIN - 1 }),
      stint({ delta: -5 }),
      stint({ delta: 30, odometerGap: true }),
    ];
    const sessions = chargingSessions(stints, 80);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].energyKwh).toBeCloseTo(32);
    expect(sessions[0].month).toBe('2026-01');
  });
});

describe('chargingStats', () => {
  it('summarises sessions', () => {
    const sessions = chargingSessions(
      [stint({ socBefore: 40, socAfter: 80, delta: 40 }), stint({ socBefore: 50, socAfter: 90, delta: 40 }), stint({ socBefore: 20, socAfter: 50, delta: 30 })],
      80,
    );
    const s = chargingStats(sessions, 14);
    expect(s.sessions).toBe(3);
    expect(s.sessionsPerWeek).toBeCloseTo(1.5);
    expect(s.avgSocBefore).toBeCloseTo(110 / 3);
    expect(s.avgSocAfter).toBeCloseTo(220 / 3);
    expect(s.shareTo90).toBeCloseTo(1 / 3);
    expect(s.avgGain).toBeCloseTo(110 / 3);
    expect(s.medianGain).toBe(40);
    expect(s.energyKwh).toBeCloseTo(88);
  });

  it('handles no sessions', () => {
    expect(chargingStats([], 30)).toMatchObject({ sessions: 0, sessionsPerWeek: null, avgGain: null, shareTo90: null });
  });
});

describe('monthlyCharging and histogram', () => {
  it('fills missing months with zero', () => {
    const sessions = chargingSessions([stint({ from: '2026-01-05T10:00' }), stint({ from: '2026-03-05T10:00' })], 80);
    const m = monthlyCharging(sessions, ['2026-01', '2026-02', '2026-03']);
    expect(m.map((x) => x.sessions)).toEqual([1, 0, 1]);
  });

  it('bins values and puts 100 in the last bin', () => {
    expect(histogram([0, 9, 10, 99, 100], 10)).toEqual([2, 1, 0, 0, 0, 0, 0, 0, 0, 2]);
  });
});

describe('chargingPlaces', () => {
  const home = { lat: 50, lon: 10, address: 'Home Street 1, 12345 Homeville, Country' };
  const fast = { lat: 50.05, lon: 10.05, address: 'Highway 9, 54321 Faraway, Country' };
  const at = (p: typeof home, jitter: number, partial: Partial<Stint> = {}) =>
    stint({ lat: p.lat + jitter, lon: p.lon, address: p.address, ...partial });

  it('clusters nearby sessions, sorts by count and marks home above 40 %', () => {
    const stints = [
      ...Array.from({ length: 6 }, (_, i) => at(home, i * 0.00005)), // within ~30 m
      at(fast, 0),
      at(fast, 0.0002),
      stint({ lat: 51, lon: 11, address: 'Elsewhere 3, 99999 Town, Country' }),
    ];
    const places = chargingPlaces(chargingSessions(stints, 80));
    expect(places).toHaveLength(3);
    expect(places[0]).toMatchObject({ sessions: 6, label: 'Home Street 1, Homeville', likelyHome: true });
    expect(places[0].shareOfSessions).toBeCloseTo(6 / 9);
    expect(places[1].sessions).toBe(2);
    expect(places[0].sessionKeys).toHaveLength(6);
    expect(places[2].likelyHome).toBe(false);
    expect(places.reduce((a, p) => a + p.shareOfEnergy, 0)).toBeCloseTo(1);
  });

  it('does not call the most used place home without a clear majority', () => {
    const stints = [at(home, 0), at(home, 0), at(fast, 0), at(fast, 0), stint({ lat: 51, lon: 11 })];
    const places = chargingPlaces(chargingSessions(stints, 80));
    expect(places[0].sessions).toBe(2);
    expect(places.some((p) => p.likelyHome)).toBe(false);
  });

  const saved = (partial: Partial<SavedPlace>): SavedPlace => ({ id: 's1', lat: 50, lon: 10, kind: null, price: null, label: '', ...partial });

  it('lets a place marked as work override the detected home', () => {
    const stints = [...Array.from({ length: 6 }, () => at(home, 0)), at(fast, 0)];
    const places = chargingPlaces(chargingSessions(stints, 80), [saved({ kind: 'work', lat: 50.0005 })]);
    expect(places[0]).toMatchObject({ sessions: 6, likelyHome: false, lat: 50.0005 });
    expect(placeKind(places[0])).toBe('work');
  });

  it('assigns sessions to a saved place even when they would form another cluster', () => {
    const stints = [at(home, 0), at(home, 0.0015), at(fast, 0)]; // ~170 m apart, both within 250 m of the saved place
    const places = chargingPlaces(chargingSessions(stints, 80), [saved({ lat: 50.00075, price: 0.2 })]);
    expect(places).toHaveLength(2);
    expect(places[0]).toMatchObject({ sessions: 2, saved: { price: 0.2 } });
  });

  it('prices each place and mixes by energy', () => {
    const prices = { homePrice: 0.3, publicPrice: 0.6 };
    const stints = [at(home, 0), at(home, 0), at(home, 0), at(fast, 0), stint({ lat: 51, lon: 11 })];
    const places = chargingPlaces(chargingSessions(stints, 80), [saved({ id: 'w', ...fast, kind: 'work', price: 0 })]);
    const [homePlace, work, other] = places;
    expect(placePrice(homePlace, prices)).toBe(0.3);
    expect(placePrice(work, prices)).toBe(0);
    expect(placePrice(other, prices)).toBe(0.6);
    const mix = priceMix(places, prices);
    expect(mix.price).toBeCloseTo((3 * 0.3 + 0 + 0.6) / 5);
    expect(mix.homeShare).toBeCloseTo(3 / 5);
    expect(priceMix([], prices)).toEqual({ energyKwh: 0, price: null, homeShare: null });
  });

  it('groups sessions without coordinates and never calls them home', () => {
    const places = chargingPlaces(chargingSessions([stint({ lat: null, lon: null }), stint({ lat: null, lon: null })], 80));
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ lat: null, sessions: 2, likelyHome: false });
  });
});

describe('standbyDrain', () => {
  it('pools the loss over long enough, contiguous, non-charging stints', () => {
    const stints = [
      stint({ delta: -2, parkedMinutes: 2880 }), // 1 %/day
      stint({ delta: -1, parkedMinutes: 1440 }), // 1 %/day
      stint({ delta: 1, parkedMinutes: 1440 }), // rounding noise, kept
      stint({ delta: -4, parkedMinutes: 60 }), // too short
      stint({ delta: -4, parkedMinutes: 2880, odometerGap: true }), // unreliable
      stint({ delta: 30, parkedMinutes: 2880 }), // a charge
    ];
    const d = standbyDrain(stints, 80);
    expect(d.stints).toBe(3);
    expect(d.totalDays).toBeCloseTo(4);
    expect(d.pooledPctPerDay).toBeCloseTo(0.5);
    expect(d.pooledKwhPerDay).toBeCloseTo(0.4);
    expect(d.rates).toHaveLength(3);
  });

  it('handles nothing to measure', () => {
    expect(standbyDrain([], 80)).toMatchObject({ stints: 0, pooledPctPerDay: null, medianPctPerDay: null });
  });
});

describe('energyBalance', () => {
  it('counts gap stints and standby losses separately', () => {
    const stints = [stint({ delta: 40 }), stint({ delta: -3 }), stint({ delta: 20, odometerGap: true })];
    const b = energyBalance(100, stints, chargingSessions(stints, 80), 80);
    expect(b).toMatchObject({ usedKwh: 100, stints: 3, gapStints: 1 });
    expect(b.chargedKwh).toBeCloseTo(32);
    expect(b.standbyKwh).toBeCloseTo(2.4);
  });
});

describe('with demo data', () => {
  const trips = generateDemoTrips({ endDate: new Date(2026, 8, 30), days: 365 });
  const stints = buildStints(trips);
  const capacity = recentCapacity(capacitySamples(trips))!.capacityKwh;
  const sessions = chargingSessions(stints, capacity);

  it('finds the home charger as the dominant place', () => {
    expect(sessions.length).toBeGreaterThan(20);
    const places = chargingPlaces(sessions);
    expect(places[0].likelyHome).toBe(true);
    expect(places[0].label).toContain('Vasagatan');
  });

  it('charges about as much as it uses', () => {
    const used = trips.reduce((a, t) => a + (t.energyKwh ?? 0), 0);
    const b = energyBalance(used, stints, sessions, capacity);
    expect(b.chargedKwh / used).toBeGreaterThan(0.8);
    expect(b.chargedKwh / used).toBeLessThan(1.3);
  });
});

it('trip fixture stays usable', () => {
  expect(trip({ start: '2026-01-01T08:00', end: '2026-01-01T09:00' }).id).toContain('2026-01-01T08:00');
});
