import { describe, expect, it } from 'vitest';
import type { Trip } from '../domain/trip';
import { EMPTY_FILTER, filterTrips, sortTrips, summarizeTrips } from './tripsFilter';

function trip(id: string, start: string, patch: Partial<Trip> = {}): Trip {
  return {
    id,
    start,
    end: start.slice(0, 11) + '12:00',
    startAddress: 'Alpha 1, 10000 Aville, Germany',
    endAddress: 'Beta 2, 20000 Bville, Germany',
    distanceKm: 10,
    energyKwh: 2,
    category: 'Private',
    startLat: 1,
    startLon: 1,
    endLat: 2,
    endLon: 2,
    startOdometerKm: 0,
    endOdometerKm: 10,
    tripType: 'SINGLE',
    socStart: 50,
    socEnd: 45,
    comment: '',
    ...patch,
  };
}

const trips = [
  trip('a', '2025-01-01T10:00', { distanceKm: 5, energyKwh: 1.5, comment: 'Client visit', category: 'Business' }),
  trip('b', '2025-01-02T11:00', { distanceKm: 50, energyKwh: null, tripType: 'MERGED' }),
  trip('c', '2025-01-03T09:00', { distanceKm: 20, energyKwh: 5, startAddress: 'Gamma 3, 30000 Cville, Germany' }),
  trip('d', '2025-01-04T08:00', { distanceKm: 0.4, energyKwh: 0.1, category: 'Uncategorized' }),
];

describe('filterTrips', () => {
  it('returns everything for the empty filter', () => {
    expect(filterTrips(trips, EMPTY_FILTER)).toHaveLength(4);
  });

  it('searches addresses and comments case-insensitively', () => {
    expect(filterTrips(trips, { ...EMPTY_FILTER, query: 'gamma' }).map((t) => t.id)).toEqual(['c']);
    expect(filterTrips(trips, { ...EMPTY_FILTER, query: 'CLIENT' }).map((t) => t.id)).toEqual(['a']);
  });

  it('filters by category, type and minimum distance', () => {
    expect(filterTrips(trips, { ...EMPTY_FILTER, category: 'Business' }).map((t) => t.id)).toEqual(['a']);
    expect(filterTrips(trips, { ...EMPTY_FILTER, tripType: 'MERGED' }).map((t) => t.id)).toEqual(['b']);
    expect(filterTrips(trips, { ...EMPTY_FILTER, minKm: 10 }).map((t) => t.id)).toEqual(['b', 'c']);
  });

  it('filters by place through the assignments', () => {
    const assignments = new Map([
      ['a', { from: 'p1', to: 'p2' }],
      ['b', { from: 'p2', to: 'p3' }],
      ['c', { from: null, to: null }],
    ]);
    expect(filterTrips(trips, { ...EMPTY_FILTER, placeId: 'p2' }, assignments).map((t) => t.id)).toEqual(['a', 'b']);
    expect(filterTrips(trips, { ...EMPTY_FILTER, placeId: 'p2' })).toHaveLength(0);
  });
});

describe('sortTrips', () => {
  it('sorts by distance in both directions', () => {
    expect(sortTrips(trips, 'distance', 'desc').map((t) => t.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(sortTrips(trips, 'distance', 'asc').map((t) => t.id)).toEqual(['d', 'a', 'c', 'b']);
  });

  it('puts trips without a value last in either direction', () => {
    expect(sortTrips(trips, 'energy', 'desc').map((t) => t.id)).toEqual(['c', 'a', 'd', 'b']);
    expect(sortTrips(trips, 'energy', 'asc').map((t) => t.id)).toEqual(['d', 'a', 'c', 'b']);
    expect(sortTrips(trips, 'consumption', 'asc').at(-1)?.id).toBe('b');
  });

  it('sorts by start and does not mutate the input', () => {
    const copy = [...trips];
    expect(sortTrips(trips, 'start', 'desc').map((t) => t.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(trips).toEqual(copy);
  });
});

describe('summarizeTrips', () => {
  it('sums and splits by category', () => {
    const s = summarizeTrips(trips);
    expect(s.trips).toBe(4);
    expect(s.distanceKm).toBeCloseTo(75.4);
    expect(s.energyKwh).toBeCloseTo(6.6);
    expect(s.categories.map((c) => c.category)).toEqual(['Private', 'Business', 'Uncategorized']);
    expect(s.categories[0]).toMatchObject({ trips: 2, distanceKm: 70 });
    // Consumption only uses trips with energy: 6.6 kWh over 25.4 km.
    expect(s.consumption).toBeCloseTo((6.6 / 25.4) * 100, 5);
  });

  it('copes with an empty list', () => {
    expect(summarizeTrips([])).toMatchObject({ trips: 0, distanceKm: 0, consumption: null, categories: [] });
  });
});
