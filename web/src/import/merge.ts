import { toDate, type Trip } from '../domain/trip';

export interface MergeStats {
  added: number;
  updated: number;
  unchanged: number;
  /** Existing trips removed because a newer export covers the same time span differently (e.g. merged trips). */
  replaced: number;
}

export interface MergePlan {
  put: Trip[];
  remove: string[];
  stats: MergeStats;
}

const COMPARED_FIELDS: (keyof Trip)[] = [
  'end', 'startAddress', 'endAddress', 'distanceKm', 'energyKwh', 'category', 'startLat', 'startLon',
  'endLat', 'endLon', 'startOdometerKm', 'endOdometerKm', 'tripType', 'socStart', 'socEnd', 'comment', 'review',
];

export function sameTrip(a: Trip, b: Trip): boolean {
  return COMPARED_FIELDS.every((field) => a[field] === b[field]);
}

function overlaps(a: Trip, b: Trip): boolean {
  if (a.start === b.start) return true;
  return a.start < b.end && b.start < a.end;
}

/** Collapses several parsed files into one list; later files win for the same trip id. */
export function combineIncoming(batches: readonly (readonly Trip[])[]): Trip[] {
  const byId = new Map<string, Trip>();
  for (const batch of batches) for (const trip of batch) byId.set(trip.id, trip);
  return [...byId.values()];
}

/**
 * Plans how to fold a new export into the stored trips.
 *
 * Exports are incremental and may overlap with earlier ones. Trips are matched
 * by id (start time + start odometer). A stored trip that is missing from the
 * export but overlaps an exported trip in time was changed in the app (merged
 * or split), so the export is taken as the newer truth and it is removed.
 * The user's review decision is kept unless the incoming trip carries its own
 * (backups do).
 */
const MAX_TRIP_DAYS = 31;

function horizon(start: string): string {
  const date = toDate(start);
  date.setDate(date.getDate() - MAX_TRIP_DAYS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T00:00`;
}

export function planMerge(existing: readonly Trip[], incoming: readonly Trip[]): MergePlan {
  const existingById = new Map(existing.map((t) => [t.id, t]));
  const incomingIds = new Set(incoming.map((t) => t.id));
  const stats: MergeStats = { added: 0, updated: 0, unchanged: 0, replaced: 0 };
  const put: Trip[] = [];

  for (const exported of incoming) {
    const current = existingById.get(exported.id);
    // Exports know nothing about reviews; a decision made here survives every later import.
    const trip = current?.review && exported.review === undefined ? { ...exported, review: current.review } : exported;
    if (!current) {
      stats.added++;
      put.push(trip);
    } else if (!sameTrip(current, trip)) {
      stats.updated++;
      put.push(trip);
    } else {
      stats.unchanged++;
    }
  }

  const sortedIncoming = [...incoming].sort((a, b) => a.start.localeCompare(b.start));
  const remove: string[] = [];
  for (const trip of existing) {
    if (incomingIds.has(trip.id)) continue;
    // Only incoming trips starting before this trip ends can overlap it.
    let lo = 0;
    let hi = sortedIncoming.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedIncoming[mid].start <= trip.end) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo - 1; i >= 0; i--) {
      const candidate = sortedIncoming[i];
      if (overlaps(trip, candidate)) {
        remove.push(trip.id);
        stats.replaced++;
        break;
      }
      // No real trip lasts a month; stop scanning once the candidates start that far back.
      if (candidate.start < horizon(trip.start)) break;
    }
  }
  return { put, remove, stats };
}
