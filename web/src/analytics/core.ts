import { durationMinutes, toDate, type Trip } from '../domain/trip';

export interface Totals {
  trips: number;
  distanceKm: number;
  /** Energy of trips that report consumption. */
  energyKwh: number;
  /** Distance of the trips that report consumption, the base for averages. */
  distanceWithEnergyKm: number;
  /** kWh/100 km, null without data. */
  consumption: number | null;
  drivingMinutes: number;
  /** Average speed while driving in km/h, null without data. */
  averageSpeed: number | null;
  firstStart: string | null;
  lastEnd: string | null;
  /** Latest odometer reading in km. */
  odometerKm: number | null;
  activeDays: number;
  /** Days between first and last trip, inclusive. */
  spanDays: number;
}

export function totals(trips: readonly Trip[]): Totals {
  let distanceKm = 0;
  let energyKwh = 0;
  let distanceWithEnergyKm = 0;
  let drivingMinutes = 0;
  let odometerKm: number | null = null;
  let firstStart: string | null = null;
  let lastEnd: string | null = null;
  const days = new Set<string>();
  for (const t of trips) {
    distanceKm += t.distanceKm;
    if (t.energyKwh != null && t.distanceKm > 0) {
      energyKwh += t.energyKwh;
      distanceWithEnergyKm += t.distanceKm;
    }
    drivingMinutes += durationMinutes(t);
    if (t.endOdometerKm != null && (odometerKm == null || t.endOdometerKm > odometerKm)) odometerKm = t.endOdometerKm;
    if (firstStart == null || t.start < firstStart) firstStart = t.start;
    if (lastEnd == null || t.end > lastEnd) lastEnd = t.end;
    days.add(t.start.slice(0, 10));
  }
  const spanDays =
    firstStart && lastEnd ? Math.round((toDate(lastEnd.slice(0, 10) + 'T00:00').getTime() - toDate(firstStart.slice(0, 10) + 'T00:00').getTime()) / 86400000) + 1 : 0;
  return {
    trips: trips.length,
    distanceKm,
    energyKwh,
    distanceWithEnergyKm,
    consumption: distanceWithEnergyKm > 0 ? (energyKwh / distanceWithEnergyKm) * 100 : null,
    drivingMinutes,
    averageSpeed: drivingMinutes > 0 ? distanceKm / (drivingMinutes / 60) : null,
    firstStart,
    lastEnd,
    odometerKm,
    activeDays: days.size,
    spanDays,
  };
}

export interface Bucket extends Totals {
  key: string;
}

/** Groups trips by a key derived from the trip (e.g. month) and computes totals per group, sorted by key. */
export function groupTotals(trips: readonly Trip[], keyOf: (trip: Trip) => string): Bucket[] {
  const groups = new Map<string, Trip[]>();
  for (const t of trips) {
    const key = keyOf(t);
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(t);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, list]) => ({ key, ...totals(list) }));
}

export const monthKey = (t: Pick<Trip, 'start'>) => t.start.slice(0, 7);
export const dayKey = (t: Pick<Trip, 'start'>) => t.start.slice(0, 10);

/** All months between two `YYYY-MM` keys, inclusive. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Monthly totals including empty months so time axes have no holes. */
export function monthlyTotals(trips: readonly Trip[]): Bucket[] {
  if (trips.length === 0) return [];
  const buckets = new Map(groupTotals(trips, monthKey).map((b) => [b.key, b]));
  const keys = [...buckets.keys()];
  return monthRange(keys[0], keys[keys.length - 1]).map((key) => buckets.get(key) ?? { key, ...totals([]) });
}

/** Median of a list of numbers, null for an empty list. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
