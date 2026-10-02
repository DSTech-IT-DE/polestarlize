import { consumptionPer100, durationMinutes, type Trip } from '../domain/trip';
import { totals } from './core';
import type { TripPlaces } from './places';
import type { TripCheck } from './plausibility';

export interface TripFilter {
  /** Free text matched against both addresses and the comment. */
  query: string;
  /** Exact category, '' for all. */
  category: string;
  /** `SINGLE`, `MERGED` or '' for all. */
  tripType: string;
  /** Minimum distance in km. */
  minKm: number;
  /** Place id: trips that start or end there. */
  placeId: string;
  /** `review` (waiting for a decision), `excluded`, `flagged` (any plausibility issue) or '' for all. */
  status: TripStatusFilter;
}

export type TripStatusFilter = '' | 'review' | 'excluded' | 'flagged';

export const EMPTY_FILTER: TripFilter = { query: '', category: '', tripType: '', minKm: 0, placeId: '', status: '' };

function matchesStatus(check: TripCheck | undefined, status: TripStatusFilter): boolean {
  if (!status) return true;
  if (!check) return false;
  return status === 'flagged' ? check.issues.length > 0 : check.status === status;
}

export type TripSortKey = 'start' | 'distance' | 'energy' | 'consumption' | 'duration';
export type SortDirection = 'asc' | 'desc';

/** Filters trips; `assignments` is only needed for `placeId`, `checks` only for `status`. */
export function filterTrips<T extends Trip>(
  trips: readonly T[],
  filter: TripFilter,
  assignments?: ReadonlyMap<string, TripPlaces>,
  checks?: ReadonlyMap<string, TripCheck>,
): T[] {
  const q = filter.query.trim().toLowerCase();
  return trips.filter((t) => {
    if (!matchesStatus(checks?.get(t.id), filter.status)) return false;
    if (filter.category && t.category !== filter.category) return false;
    if (filter.tripType && t.tripType !== filter.tripType) return false;
    if (filter.minKm > 0 && t.distanceKm < filter.minKm) return false;
    if (filter.placeId) {
      const a = assignments?.get(t.id);
      if (a?.from !== filter.placeId && a?.to !== filter.placeId) return false;
    }
    if (q && !`${t.startAddress}\n${t.endAddress}\n${t.comment}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function valueOf(t: Trip, key: TripSortKey): string | number | null {
  switch (key) {
    case 'start':
      return t.start;
    case 'distance':
      return t.distanceKm;
    case 'energy':
      return t.energyKwh;
    case 'consumption':
      return consumptionPer100(t);
    case 'duration':
      return durationMinutes(t);
  }
}

/** Returns a sorted copy. Trips without a value (no energy, …) always go last. */
export function sortTrips<T extends Trip>(trips: readonly T[], key: TripSortKey, direction: SortDirection): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  const keyed = trips.map((t) => ({ t, v: valueOf(t, key) }));
  keyed.sort((a, b) => {
    if (a.v == null || b.v == null) return a.v == null ? (b.v == null ? 0 : 1) : -1;
    const c = a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
    return c !== 0 ? sign * c : b.t.start.localeCompare(a.t.start);
  });
  return keyed.map((k) => k.t);
}

export interface CategorySplit {
  category: string;
  trips: number;
  distanceKm: number;
}

export interface TripSummary {
  trips: number;
  distanceKm: number;
  energyKwh: number;
  consumption: number | null;
  /** Sorted by distance, descending. */
  categories: CategorySplit[];
}

export function summarizeTrips(trips: readonly Trip[]): TripSummary {
  const sum = totals(trips);
  const split = new Map<string, CategorySplit>();
  for (const t of trips) {
    const key = t.category || '';
    let c = split.get(key);
    if (!c) split.set(key, (c = { category: key, trips: 0, distanceKm: 0 }));
    c.trips++;
    c.distanceKm += t.distanceKm;
  }
  return {
    trips: sum.trips,
    distanceKm: sum.distanceKm,
    energyKwh: sum.energyKwh,
    consumption: sum.consumption,
    categories: [...split.values()].sort((a, b) => b.distanceKm - a.distanceKm || a.category.localeCompare(b.category)),
  };
}
