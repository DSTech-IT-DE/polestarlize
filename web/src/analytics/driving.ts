import { consumptionPer100, durationMinutes, toDate, type Trip } from '../domain/trip';
import { dayKey, median, quantile, totals } from './core';

/** A bin needs at least this many trips with energy data before its consumption is shown. */
export const MIN_BIN_SAMPLES = 5;

/** Trips shorter than this count as "short" in the profile stats. */
export const SHORT_TRIP_KM = 5;

/** Records on efficiency ignore trips below this distance, where rounding dominates. */
export const RECORD_MIN_KM = 10;

/** Trip length classes in km. The last class is open ended. */
export const LENGTH_EDGES_KM = [0, 2, 5, 10, 20, 50, 100, 200, Infinity];

/** Average speed classes in km/h. */
export const SPEED_EDGES_KMH = [0, 30, 50, 70, 90, 110, Infinity];

export interface DayTotal {
  /** `YYYY-MM-DD` */
  date: string;
  trips: number;
  distanceKm: number;
}

/** Distance and trip count per calendar day (days without trips are absent), oldest first. */
export function dailyTotals(trips: readonly Trip[]): DayTotal[] {
  const days = new Map<string, DayTotal>();
  for (const t of trips) {
    const date = dayKey(t);
    let day = days.get(date);
    if (!day) days.set(date, (day = { date, trips: 0, distanceKm: 0 }));
    day.trips++;
    day.distanceKm += t.distanceKm;
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Average speed of a trip in km/h, null when the duration is zero (minute resolution). */
export function tripSpeed(trip: Pick<Trip, 'start' | 'end' | 'distanceKm'>): number | null {
  const minutes = durationMinutes(trip);
  return minutes > 0 && trip.distanceKm > 0 ? trip.distanceKm / (minutes / 60) : null;
}

export interface DrivingStats {
  trips: number;
  activeDays: number;
  tripsPerActiveDay: number | null;
  averageKm: number | null;
  medianKm: number | null;
  /** Share of trips shorter than `SHORT_TRIP_KM`, 0..1. */
  shortShare: number | null;
  /** Distance / driving time, km/h. */
  averageSpeed: number | null;
  longestTrip: Trip | null;
  busiestDay: DayTotal | null;
}

export function drivingStats(trips: readonly Trip[]): DrivingStats {
  const sum = totals(trips);
  const days = dailyTotals(trips);
  let longestTrip: Trip | null = null;
  let short = 0;
  for (const t of trips) {
    if (!longestTrip || t.distanceKm > longestTrip.distanceKm) longestTrip = t;
    if (t.distanceKm < SHORT_TRIP_KM) short++;
  }
  let busiestDay: DayTotal | null = null;
  for (const d of days) if (!busiestDay || d.trips > busiestDay.trips || (d.trips === busiestDay.trips && d.distanceKm > busiestDay.distanceKm)) busiestDay = d;
  return {
    trips: trips.length,
    activeDays: sum.activeDays,
    tripsPerActiveDay: sum.activeDays > 0 ? trips.length / sum.activeDays : null,
    averageKm: trips.length > 0 ? sum.distanceKm / trips.length : null,
    medianKm: median(trips.map((t) => t.distanceKm)),
    shortShare: trips.length > 0 ? short / trips.length : null,
    averageSpeed: sum.averageSpeed,
    longestTrip,
    busiestDay,
  };
}

export interface WeekdayHourGrid {
  /** `count[weekday][hour]`, weekday 0 = Monday. */
  count: number[][];
  distanceKm: number[][];
}

/** Trips by weekday (Monday first) and start hour. */
export function weekdayHourGrid(trips: readonly Trip[]): WeekdayHourGrid {
  const make = () => Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const grid: WeekdayHourGrid = { count: make(), distanceKm: make() };
  for (const t of trips) {
    const date = toDate(t.start);
    const weekday = (date.getDay() + 6) % 7;
    const hour = date.getHours();
    grid.count[weekday][hour]++;
    grid.distanceKm[weekday][hour] += t.distanceKm;
  }
  return grid;
}

export interface TripBin {
  from: number;
  /** Infinity for the open last bin. */
  to: number;
  trips: number;
  distanceKm: number;
  /** Trips that report energy, the sample size behind the consumption figures. */
  samples: number;
  /** Energy-weighted consumption in kWh/100 km (sum of energy / sum of distance); null with too few samples. */
  consumption: number | null;
  /** Quartiles of the per-trip consumption; null with too few samples. */
  q1: number | null;
  median: number | null;
  q3: number | null;
}

/**
 * Splits trips into half-open classes [from, to) of `valueOf(trip)` and computes count,
 * distance and consumption per class. Trips for which `valueOf` returns null are skipped.
 */
export function binTrips(trips: readonly Trip[], edges: readonly number[], valueOf: (trip: Trip) => number | null, minSamples = MIN_BIN_SAMPLES): TripBin[] {
  const bins = edges.slice(0, -1).map((from, i) => ({
    from,
    to: edges[i + 1],
    trips: 0,
    distanceKm: 0,
    energyKwh: 0,
    energyDistanceKm: 0,
    ratios: [] as number[],
  }));
  for (const t of trips) {
    const value = valueOf(t);
    if (value == null) continue;
    const bin = bins.find((b) => value >= b.from && value < b.to);
    if (!bin) continue;
    bin.trips++;
    bin.distanceKm += t.distanceKm;
    const ratio = consumptionPer100(t);
    if (ratio != null) {
      bin.energyKwh += t.energyKwh!;
      bin.energyDistanceKm += t.distanceKm;
      bin.ratios.push(ratio);
    }
  }
  return bins.map((b) => {
    const enough = b.ratios.length >= minSamples && b.energyDistanceKm > 0;
    return {
      from: b.from,
      to: b.to,
      trips: b.trips,
      distanceKm: b.distanceKm,
      samples: b.ratios.length,
      consumption: enough ? (b.energyKwh / b.energyDistanceKm) * 100 : null,
      q1: enough ? quantile(b.ratios, 0.25) : null,
      median: enough ? quantile(b.ratios, 0.5) : null,
      q3: enough ? quantile(b.ratios, 0.75) : null,
    };
  });
}

export const lengthBins = (trips: readonly Trip[]) => binTrips(trips, LENGTH_EDGES_KM, (t) => t.distanceKm);
export const speedBins = (trips: readonly Trip[]) => binTrips(trips, SPEED_EDGES_KMH, tripSpeed);

export interface MonthOfYear {
  /** 0 = January. */
  month: number;
  trips: number;
  samples: number;
  /** Energy-weighted kWh/100 km over all years, null with too few samples. */
  consumption: number | null;
}

/** Consumption per calendar month over all years, for the seasonal pattern. */
export function consumptionByMonthOfYear(trips: readonly Trip[], minSamples = MIN_BIN_SAMPLES): MonthOfYear[] {
  const acc = Array.from({ length: 12 }, () => ({ trips: 0, samples: 0, energy: 0, distance: 0 }));
  for (const t of trips) {
    const a = acc[Number(t.start.slice(5, 7)) - 1];
    a.trips++;
    if (t.energyKwh != null && t.distanceKm > 0) {
      a.samples++;
      a.energy += t.energyKwh;
      a.distance += t.distanceKm;
    }
  }
  return acc.map((a, month) => ({
    month,
    trips: a.trips,
    samples: a.samples,
    consumption: a.samples >= minSamples && a.distance > 0 ? (a.energy / a.distance) * 100 : null,
  }));
}

export interface Streak {
  days: number;
  from: string;
  to: string;
}

const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};

/** Longest run of consecutive calendar days with at least one trip. */
export function longestStreak(days: readonly { date: string }[]): Streak | null {
  let best: Streak | null = null;
  let from: string | null = null;
  let previous = 0;
  let length = 0;
  for (const { date } of days) {
    const n = dayNumber(date);
    if (from != null && n === previous + 1) length++;
    else {
      from = date;
      length = 1;
    }
    previous = n;
    if (!best || length > best.days) best = { days: length, from, to: date };
  }
  return best;
}

export interface DrivingRecords {
  longestTrip: Trip | null;
  longestDay: DayTotal | null;
  mostEfficientTrip: Trip | null;
  leastEfficientTrip: Trip | null;
  streak: Streak | null;
  mostTripsDay: DayTotal | null;
  fastestTrip: Trip | null;
}

export function drivingRecords(trips: readonly Trip[]): DrivingRecords {
  const days = dailyTotals(trips);
  let longestTrip: Trip | null = null;
  let best: Trip | null = null;
  let worst: Trip | null = null;
  let fastest: Trip | null = null;
  let fastestSpeed = 0;
  for (const t of trips) {
    if (!longestTrip || t.distanceKm > longestTrip.distanceKm) longestTrip = t;
    if (t.distanceKm < RECORD_MIN_KM) continue;
    const c = consumptionPer100(t);
    if (c != null) {
      if (!best || c < consumptionPer100(best)!) best = t;
      if (!worst || c > consumptionPer100(worst)!) worst = t;
    }
    const speed = tripSpeed(t);
    if (speed != null && speed > fastestSpeed) {
      fastestSpeed = speed;
      fastest = t;
    }
  }
  let longestDay: DayTotal | null = null;
  let mostTripsDay: DayTotal | null = null;
  for (const d of days) {
    if (!longestDay || d.distanceKm > longestDay.distanceKm) longestDay = d;
    if (!mostTripsDay || d.trips > mostTripsDay.trips) mostTripsDay = d;
  }
  return { longestTrip, longestDay, mostEfficientTrip: best, leastEfficientTrip: worst, streak: longestStreak(days), mostTripsDay, fastestTrip: fastest };
}

export interface CategoryShare {
  /** Raw category from the export (may be empty); meaningless for the folded row, see `isOther`. */
  category: string;
  /** True for the folded remainder. */
  isOther: boolean;
  trips: number;
  distanceKm: number;
  /** 0..1 of the total distance. */
  share: number;
}

/** Distance per category, largest first; everything beyond `max` categories is folded into one "other" row. */
export function categoryShares(trips: readonly Trip[], max = 3): CategoryShare[] {
  const map = new Map<string, { trips: number; distanceKm: number }>();
  let total = 0;
  for (const t of trips) {
    const entry = map.get(t.category) ?? { trips: 0, distanceKm: 0 };
    entry.trips++;
    entry.distanceKm += t.distanceKm;
    map.set(t.category, entry);
    total += t.distanceKm;
  }
  const sorted = [...map.entries()].sort((a, b) => b[1].distanceKm - a[1].distanceKm);
  const rows: CategoryShare[] = sorted.slice(0, max).map(([category, e]) => ({ category, isOther: false, ...e, share: total > 0 ? e.distanceKm / total : 0 }));
  const rest = sorted.slice(max);
  if (rest.length > 0) {
    const tripsRest = rest.reduce((s, [, e]) => s + e.trips, 0);
    const distanceRest = rest.reduce((s, [, e]) => s + e.distanceKm, 0);
    rows.push({ category: '', isOther: true, trips: tripsRest, distanceKm: distanceRest, share: total > 0 ? distanceRest / total : 0 });
  }
  return rows;
}

/**
 * Colour class 1..5 for a value, based on quantiles of the positive values so a few long
 * days do not wash out the rest. 0 means "no data".
 */
export function rampClasses(values: readonly number[]): (value: number) => 0 | 1 | 2 | 3 | 4 | 5 {
  const positive = values.filter((v) => v > 0);
  const cuts = [0.2, 0.4, 0.6, 0.8].map((q) => quantile(positive, q) ?? 0);
  return (value) => {
    if (!(value > 0)) return 0;
    let cls = 1;
    for (const cut of cuts) if (value > cut) cls++;
    return cls as 1 | 2 | 3 | 4 | 5;
  };
}
