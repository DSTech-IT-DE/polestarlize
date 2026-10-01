import { durationMinutes, type Trip } from '../domain/trip';
import type { TripPlaces } from './places';

export interface PlaceRoute {
  /** `a>b` for directed routes, `a~b` for combined ones. */
  key: string;
  from: string;
  to: string;
  /** False when both directions are merged; `from`/`to` then name the more frequent direction. */
  directed: boolean;
  count: number;
  avgDistanceKm: number;
  /** kWh/100 km over the trips that report energy, null when none does. */
  consumption: number | null;
  avgDurationMin: number;
}

interface Acc {
  from: string;
  to: string;
  forward: number;
  count: number;
  distance: number;
  energy: number;
  energyDistance: number;
  minutes: number;
}

/**
 * Frequent place pairs. Trips that start and end at the same place (errands,
 * loops) and trips without coordinates are not routes.
 */
export function frequentRoutes(
  trips: readonly Trip[],
  assignments: ReadonlyMap<string, TripPlaces>,
  options: { combined?: boolean; minCount?: number; limit?: number } = {},
): PlaceRoute[] {
  const { combined = false, minCount = 2, limit } = options;
  const groups = new Map<string, Acc>();
  for (const t of trips) {
    const a = assignments.get(t.id);
    if (!a?.from || !a.to || a.from === a.to) continue;
    const key = combined ? [a.from, a.to].sort().join('~') : `${a.from}>${a.to}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { from: a.from, to: a.to, forward: 0, count: 0, distance: 0, energy: 0, energyDistance: 0, minutes: 0 }));
    g.count++;
    if (a.from === g.from) g.forward++;
    g.distance += t.distanceKm;
    g.minutes += durationMinutes(t);
    if (t.energyKwh != null && t.distanceKm > 0) {
      g.energy += t.energyKwh;
      g.energyDistance += t.distanceKm;
    }
  }
  const routes = [...groups.entries()]
    .filter(([, g]) => g.count >= minCount)
    .map(([key, g]): PlaceRoute => {
      // Name the combined route after its busier direction.
      const flip = combined && g.forward * 2 < g.count;
      return {
        key,
        from: flip ? g.to : g.from,
        to: flip ? g.from : g.to,
        directed: !combined,
        count: g.count,
        avgDistanceKm: g.distance / g.count,
        consumption: g.energyDistance > 0 ? (g.energy / g.energyDistance) * 100 : null,
        avgDurationMin: g.minutes / g.count,
      };
    })
    .sort((a, b) => b.count - a.count || b.avgDistanceKm - a.avgDistanceKm || a.key.localeCompare(b.key));
  return limit ? routes.slice(0, limit) : routes;
}
