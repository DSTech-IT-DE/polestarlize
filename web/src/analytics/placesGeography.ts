import type { Trip } from '../domain/trip';
import { parseAddress } from '../lib/address';
import { haversineKm, type Place } from './places';

export interface GeoEntry {
  name: string;
  /** Country a town belongs to ('' for countries). */
  country: string;
  /** Arrivals at addresses in this town/country. */
  visits: number;
  firstVisit: string;
  lastVisit: string;
}

export interface Geography {
  countries: GeoEntry[];
  towns: GeoEntry[];
  /** [minLon, minLat, maxLon, maxLat] over all places, null without places. */
  bounds: [number, number, number, number] | null;
  uniquePlaces: number;
  farthest: { place: Place; distanceKm: number } | null;
  /** Straight-line distance between home and work. */
  homeToWorkKm: number | null;
}

function tally(map: Map<string, GeoEntry>, key: string, name: string, country: string, time: string, visit: boolean) {
  let e = map.get(key);
  if (!e) map.set(key, (e = { name, country, visits: 0, firstVisit: time, lastVisit: time }));
  if (visit) e.visits++;
  if (time < e.firstVisit) e.firstVisit = time;
  if (time > e.lastVisit) e.lastVisit = time;
}

/** Countries and towns come from the address text, places and distances from coordinates. */
export function geography(trips: readonly Trip[], places: readonly Place[], home: Place | null, work: Place | null): Geography {
  const countries = new Map<string, GeoEntry>();
  const towns = new Map<string, GeoEntry>();
  const add = (address: string, time: string, visit: boolean) => {
    if (!address) return;
    const { town, country } = parseAddress(address);
    if (country) tally(countries, country, country, '', time, visit);
    if (town) tally(towns, `${town}|${country}`, town, country, time, visit);
  };
  for (const t of trips) {
    // Start addresses only register presence, so the very first departure still counts as a place.
    add(t.startAddress, t.start, false);
    add(t.endAddress, t.end, true);
  }
  const byVisits = (a: GeoEntry, b: GeoEntry) => b.visits - a.visits || a.name.localeCompare(b.name);

  let bounds: Geography['bounds'] = null;
  for (const p of places) {
    bounds = bounds
      ? [Math.min(bounds[0], p.lon), Math.min(bounds[1], p.lat), Math.max(bounds[2], p.lon), Math.max(bounds[3], p.lat)]
      : [p.lon, p.lat, p.lon, p.lat];
  }

  let farthest: Geography['farthest'] = null;
  if (home) {
    for (const p of places) {
      const d = haversineKm(home.lat, home.lon, p.lat, p.lon);
      if (!farthest || d > farthest.distanceKm) farthest = { place: p, distanceKm: d };
    }
  }

  return {
    countries: [...countries.values()].sort(byVisits),
    towns: [...towns.values()].sort(byVisits),
    bounds,
    uniquePlaces: places.length,
    farthest,
    homeToWorkKm: home && work ? haversineKm(home.lat, home.lon, work.lat, work.lon) : null,
  };
}
