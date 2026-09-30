import { sortByStart, toDate, type Trip } from '../domain/trip';

/** Odometer gaps up to this many km are treated as rounding, larger ones as missing trips. */
export const ODOMETER_GAP_TOLERANCE_KM = 1;

/**
 * The time a car spent parked between two consecutive trips. The state of charge
 * before and after reveals what happened in between: a gain means charging, a
 * loss means standby drain.
 */
export interface Stint {
  /** Start of the parking window (end of the previous trip), local time. */
  from: string;
  /** End of the parking window (start of the next trip), local time. */
  to: string;
  parkedMinutes: number;
  /** Where the car stood: the end of the previous trip. */
  address: string;
  lat: number | null;
  lon: number | null;
  socBefore: number;
  socAfter: number;
  /** `socAfter - socBefore`: positive = charged, negative = drained. */
  delta: number;
  /** Kilometres driven between the two trips that are not in the data (0 when contiguous or unknown). */
  missingKm: number;
  /** True when trips are missing in between, so the SOC change cannot be attributed to parking. */
  odometerGap: boolean;
}

/** Stints between consecutive trips (by start time). Pairs without SOC data or with overlapping times are skipped. */
export function buildStints(trips: readonly Trip[]): Stint[] {
  const sorted = sortByStart(trips);
  const out: Stint[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    if (prev.socEnd == null || next.socStart == null) continue;
    const parkedMinutes = (toDate(next.start).getTime() - toDate(prev.end).getTime()) / 60000;
    if (parkedMinutes < 0) continue;
    const missingKm =
      prev.endOdometerKm != null && next.startOdometerKm != null ? Math.max(0, next.startOdometerKm - prev.endOdometerKm) : 0;
    out.push({
      from: prev.end,
      to: next.start,
      parkedMinutes,
      address: prev.endAddress,
      lat: prev.endLat,
      lon: prev.endLon,
      socBefore: prev.socEnd,
      socAfter: next.socStart,
      delta: next.socStart - prev.socEnd,
      missingKm,
      odometerGap: missingKm > ODOMETER_GAP_TOLERANCE_KM,
    });
  }
  return out;
}

/** Great-circle distance in metres. */
export function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "Street 1, 12345 Town, Country" → "Street 1, Town". Falls back to the input for unusual formats. */
export function shortAddress(address: string): string {
  const parts = address.split(',').map((p) => p.trim());
  if (parts.length < 3) return address || '';
  const town = parts[parts.length - 2].replace(/^\d{4,6}\s+|^\d{3}\s\d{2}\s+/, '');
  return `${parts[0]}, ${town}`;
}
