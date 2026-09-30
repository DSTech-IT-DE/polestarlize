/**
 * A single journey as recorded by the Polestar Journey Log.
 *
 * Distances and odometer values are always stored in kilometres; exports in
 * miles are converted on import. Dates are local wall-clock times of the car
 * without a timezone, formatted as `YYYY-MM-DDTHH:mm`.
 */
export interface Trip {
  /** Stable identity used for incremental imports: `<start>|<startOdometerKm>`. */
  id: string;
  start: string;
  end: string;
  startAddress: string;
  endAddress: string;
  distanceKm: number;
  /** Energy used in kWh. `null` when the car reported 0 or nothing. */
  energyKwh: number | null;
  category: string;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  /** `SINGLE` or `MERGED` (several trips joined in the app). */
  tripType: string;
  /** State of charge in percent at trip start. */
  socStart: number | null;
  /** State of charge in percent at trip end. */
  socEnd: number | null;
  comment: string;
}

/** A trip as persisted locally, with bookkeeping for sync. */
export interface StoredTrip extends Trip {
  /** ISO timestamp of the last local change. */
  updatedAt: string;
  /** 1 while the change has not been pushed to a sync server yet. */
  dirty: 0 | 1;
}

export type DistanceUnit = 'km' | 'mi';

export const KM_PER_MILE = 1.609344;

/** Parses the local `YYYY-MM-DDTHH:mm` format into a Date in the browser's local zone. */
export function toDate(local: string): Date {
  const [datePart, timePart = '00:00'] = local.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

/** Trip duration in minutes (never negative). */
export function durationMinutes(trip: Pick<Trip, 'start' | 'end'>): number {
  return Math.max(0, (toDate(trip.end).getTime() - toDate(trip.start).getTime()) / 60000);
}

/** Consumption in kWh/100 km, or null when it cannot be computed reliably. */
export function consumptionPer100(trip: Pick<Trip, 'energyKwh' | 'distanceKm'>): number | null {
  if (trip.energyKwh == null || trip.distanceKm <= 0) return null;
  return (trip.energyKwh / trip.distanceKm) * 100;
}

export function tripId(start: string, startOdometerKm: number | null): string {
  return `${start}|${startOdometerKm ?? ''}`;
}

/** Sorts trips chronologically (oldest first). Returns a new array. */
export function sortByStart<T extends Pick<Trip, 'start'>>(trips: readonly T[]): T[] {
  return [...trips].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}
