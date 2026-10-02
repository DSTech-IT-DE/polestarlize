import { durationMinutes, type Trip } from '../domain/trip';

export type { TripReview } from '../domain/trip';

/**
 * Checks for recordings that cannot be real trips. The Journey Log sometimes
 * misses the end of a trip and closes it days later, or reports no energy.
 * Such trips distort every average, so they are flagged and left out of the
 * analyses until the user decides otherwise.
 */
export type TripIssue = 'low-consumption' | 'long-duration' | 'too-fast' | 'odometer-mismatch' | 'soc-gain';

/** Below this an electric car of this size cannot move, not even downhill on average. */
export const MIN_CONSUMPTION_KWH_PER_100KM = 10;
/** Shorter trips are too strongly affected by the rounding of distance and SOC to judge. */
const MIN_DISTANCE_ENERGY_KM = 5;
const MIN_DISTANCE_SOC_KM = 20;
/** A single (not merged) recording longer than this missed its end. */
const MAX_SINGLE_TRIP_HOURS = 24;
const MAX_AVERAGE_SPEED_KMH = 200;
/** Recuperation can add a little charge downhill, but not this much. */
const MAX_SOC_GAIN = 5;

export interface PlausibilityOptions {
  /** Usable battery capacity in kWh, to estimate energy from the SOC drop when the car reports none. */
  capacityKwh: number;
}

/**
 * Lowest consumption the trip can have had in kWh/100 km, or null if unknown.
 * Without reported energy it is estimated from the SOC drop; SOC values are
 * whole percent, so one point is added to stay on the safe side.
 */
export function minimumConsumption(trip: Trip, options: PlausibilityOptions): { value: number; source: 'energy' | 'soc' } | null {
  if (trip.energyKwh != null) {
    if (trip.distanceKm < MIN_DISTANCE_ENERGY_KM) return null;
    return { value: (trip.energyKwh / trip.distanceKm) * 100, source: 'energy' };
  }
  if (trip.socStart == null || trip.socEnd == null || trip.distanceKm < MIN_DISTANCE_SOC_KM) return null;
  const energy = ((trip.socStart - trip.socEnd + 1) / 100) * options.capacityKwh;
  return { value: (energy / trip.distanceKm) * 100, source: 'soc' };
}

export function checkTrip(trip: Trip, options: PlausibilityOptions): TripIssue[] {
  const issues: TripIssue[] = [];
  const consumption = minimumConsumption(trip, options);
  if (consumption && consumption.value < MIN_CONSUMPTION_KWH_PER_100KM) issues.push('low-consumption');

  const hours = durationMinutes(trip) / 60;
  if (trip.tripType !== 'MERGED' && hours > MAX_SINGLE_TRIP_HOURS) issues.push('long-duration');
  if (hours > 0 && trip.distanceKm / hours > MAX_AVERAGE_SPEED_KMH) issues.push('too-fast');

  if (trip.startOdometerKm != null && trip.endOdometerKm != null) {
    const driven = trip.endOdometerKm - trip.startOdometerKm;
    // Distance and odometer are both rounded to whole units.
    if (driven < 0 || Math.abs(driven - trip.distanceKm) > Math.max(2, trip.distanceKm * 0.1)) issues.push('odometer-mismatch');
  }
  if (trip.socStart != null && trip.socEnd != null && trip.socEnd - trip.socStart >= MAX_SOC_GAIN) issues.push('soc-gain');
  return issues;
}

export type TripStatus =
  /** Nothing suspicious, or the user explicitly kept it. */
  | 'ok'
  /** Suspicious and not decided yet: left out of the analyses until reviewed. */
  | 'review'
  /** Left out by the user. */
  | 'excluded';

export interface TripCheck {
  issues: TripIssue[];
  status: TripStatus;
}

export function tripCheck(trip: Trip, options: PlausibilityOptions): TripCheck {
  const issues = checkTrip(trip, options);
  if (trip.review === 'exclude') return { issues, status: 'excluded' };
  if (trip.review === 'include' || issues.length === 0) return { issues, status: 'ok' };
  return { issues, status: 'review' };
}

export function isCounted(check: TripCheck): boolean {
  return check.status === 'ok';
}

export interface CheckedTrips<T extends Trip> {
  /** Trips that go into the analyses. */
  counted: T[];
  checks: Map<string, TripCheck>;
  /** Number of suspicious trips without a decision. */
  pendingReview: number;
  excluded: number;
}

export function checkTrips<T extends Trip>(trips: readonly T[], options: PlausibilityOptions): CheckedTrips<T> {
  const checks = new Map<string, TripCheck>();
  const counted: T[] = [];
  let pendingReview = 0;
  let excluded = 0;
  for (const trip of trips) {
    const check = tripCheck(trip, options);
    checks.set(trip.id, check);
    if (check.status === 'ok') counted.push(trip);
    else if (check.status === 'review') pendingReview++;
    else excluded++;
  }
  return { counted, checks, pendingReview, excluded };
}
