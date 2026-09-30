import { toDate, type Trip } from '../domain/trip';
import { parseAddress, shortAddress } from '../lib/address';
import { median } from './core';

/** Endpoints closer than this (metres) are the same place. GPS jitter is a few metres, car parks are bigger. */
export const PLACE_RADIUS_M = 150;
const EARTH_RADIUS_KM = 6371;
const RAD = Math.PI / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Place {
  /** `p1`, `p2`, … by descending visit count within one analysis. */
  id: string;
  lat: number;
  lon: number;
  /** Most frequent short address ("Street 1, Town"). */
  label: string;
  /** Most frequent full address. */
  address: string;
  town: string;
  country: string;
  arrivals: number;
  departures: number;
  /** `max(arrivals, departures)`: a visit normally has both, a gap in the data only one. */
  visits: number;
  firstVisit: string;
  lastVisit: string;
  /** Median parking time in minutes (next departure − arrival), null when never observed. */
  dwellMedianMin: number | null;
  /** Share of all trips (0..1) that start or end here. */
  tripShare: number;
  isHome: boolean;
  isWork: boolean;
}

/** Which place a trip starts and ends at (null = no usable coordinates). */
export interface TripPlaces {
  from: string | null;
  to: string | null;
}

export interface PlaceAnalysis {
  /** Sorted by visits, descending. */
  places: Place[];
  byId: Map<string, Place>;
  /** Keyed by trip id. */
  assignments: Map<string, TripPlaces>;
  home: Place | null;
  work: Place | null;
}

interface Endpoint {
  lat: number;
  lon: number;
}

/** Spatial hash with cells about `sizeM` metres wide for radius queries up to that size. */
class Grid<T extends Endpoint> {
  private readonly cells = new Map<string, T[]>();
  private readonly dLat: number;

  constructor(sizeM: number) {
    this.dLat = sizeM / 111_320;
  }

  private row(lat: number) {
    return Math.floor(lat / this.dLat);
  }

  /** Longitude step of a row, so cells stay roughly square away from the equator. */
  private lonStep(row: number) {
    const lat = (row + 0.5) * this.dLat;
    return this.dLat / Math.max(0.01, Math.cos(lat * RAD));
  }

  private col(row: number, lon: number) {
    return Math.floor(lon / this.lonStep(row));
  }

  add(item: T) {
    const row = this.row(item.lat);
    const key = `${row}:${this.col(row, item.lon)}`;
    const cell = this.cells.get(key);
    if (cell) cell.push(item);
    else this.cells.set(key, [item]);
  }

  /** Items within `radiusM` of a point. The cell size must be ≥ the radius. */
  near(lat: number, lon: number, radiusM: number): T[] {
    const out: T[] = [];
    const row = this.row(lat);
    for (let r = row - 1; r <= row + 1; r++) {
      const col = this.col(r, lon);
      for (let c = col - 1; c <= col + 1; c++) {
        const cell = this.cells.get(`${r}:${c}`);
        if (!cell) continue;
        for (const item of cell) if (haversineKm(lat, lon, item.lat, item.lon) * 1000 <= radiusM) out.push(item);
      }
    }
    return out;
  }
}

interface Bin extends Endpoint {
  /** Number of endpoints in this bin. */
  weight: number;
  /** Endpoint indices. */
  members: number[];
  density: number;
  cluster: number;
}

/**
 * Greedy clustering of points: dense spots become centres, everything within
 * `radiusM` of a centre joins it. Points are first merged into ~25 m bins so
 * 20 000 endpoints cost a few thousand distance checks, not millions.
 * Returns the cluster index of each input point and the cluster centroids.
 */
export function clusterPoints(points: readonly Endpoint[], radiusM = PLACE_RADIUS_M): { assignment: number[]; centroids: Endpoint[] } {
  const binSizeM = 25;
  const fine = new Map<string, Bin>();
  const fineDeg = binSizeM / 111_320;
  points.forEach((p, i) => {
    const row = Math.floor(p.lat / fineDeg);
    const col = Math.floor((p.lon * Math.max(0.01, Math.cos(p.lat * RAD))) / fineDeg);
    const key = `${row}:${col}`;
    let bin = fine.get(key);
    if (!bin) fine.set(key, (bin = { lat: 0, lon: 0, weight: 0, members: [], density: 0, cluster: -1 }));
    bin.lat += p.lat;
    bin.lon += p.lon;
    bin.weight++;
    bin.members.push(i);
  });
  const bins = [...fine.values()];
  for (const bin of bins) {
    bin.lat /= bin.weight;
    bin.lon /= bin.weight;
  }

  const grid = new Grid<Bin>(radiusM);
  for (const bin of bins) grid.add(bin);
  for (const bin of bins) {
    let density = 0;
    for (const other of grid.near(bin.lat, bin.lon, radiusM)) density += other.weight;
    bin.density = density;
  }

  const order = [...bins].sort((a, b) => b.density - a.density || b.weight - a.weight);
  const centroids: Endpoint[] = [];
  const sums: { lat: number; lon: number; n: number }[] = [];
  for (const seed of order) {
    if (seed.cluster >= 0) continue;
    const index = centroids.length;
    const sum = { lat: 0, lon: 0, n: 0 };
    for (const bin of grid.near(seed.lat, seed.lon, radiusM)) {
      if (bin.cluster >= 0) continue;
      bin.cluster = index;
      sum.lat += bin.lat * bin.weight;
      sum.lon += bin.lon * bin.weight;
      sum.n += bin.weight;
    }
    sums.push(sum);
    centroids.push({ lat: sum.lat / sum.n, lon: sum.lon / sum.n });
  }

  const assignment = new Array<number>(points.length);
  for (const bin of bins) for (const m of bin.members) assignment[m] = bin.cluster;
  return { assignment, centroids };
}

const hasCoords = (lat: number | null, lon: number | null): lat is number =>
  lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);

function mostFrequent(counts: Map<string, number>): string {
  let best = '';
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

interface Acc {
  lat: number;
  lon: number;
  arrivals: number;
  departures: number;
  first: string;
  last: string;
  labels: Map<string, number>;
  addresses: Map<string, number>;
  dwell: number[];
  trips: number;
}

/** Longest parking time that still counts as a dwell (longer means data is missing or the car was stored). */
const MAX_DWELL_MIN = 60 * 24 * 30;

export function analyzePlaces(input: readonly Trip[]): PlaceAnalysis {
  const trips = [...input].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  // Endpoint 2i is the start and 2i + 1 the end of trip i; null when the trip has no coordinates.
  const points: Endpoint[] = [];
  const pointOf = new Int32Array(trips.length * 2).fill(-1);
  trips.forEach((t, i) => {
    if (hasCoords(t.startLat, t.startLon)) pointOf[2 * i] = points.push({ lat: t.startLat!, lon: t.startLon! }) - 1;
    if (hasCoords(t.endLat, t.endLon)) pointOf[2 * i + 1] = points.push({ lat: t.endLat!, lon: t.endLon! }) - 1;
  });
  const { assignment, centroids } = clusterPoints(points);
  const clusterOf = (i: number, end: boolean) => {
    const p = pointOf[2 * i + (end ? 1 : 0)];
    return p < 0 ? -1 : assignment[p];
  };

  const acc: Acc[] = centroids.map(() => ({
    lat: 0,
    lon: 0,
    arrivals: 0,
    departures: 0,
    first: '',
    last: '',
    labels: new Map(),
    addresses: new Map(),
    dwell: [],
    trips: 0,
  }));
  const touch = (c: number, time: string, address: string, p: Endpoint, arrival: boolean) => {
    const a = acc[c];
    a.lat += p.lat;
    a.lon += p.lon;
    if (arrival) a.arrivals++;
    else a.departures++;
    if (!a.first || time < a.first) a.first = time;
    if (!a.last || time > a.last) a.last = time;
    if (address) {
      bump(a.labels, shortAddress(address));
      bump(a.addresses, address);
    }
  };

  trips.forEach((t, i) => {
    const from = clusterOf(i, false);
    const to = clusterOf(i, true);
    if (from >= 0) touch(from, t.start, t.startAddress, points[pointOf[2 * i]], false);
    if (to >= 0) touch(to, t.end, t.endAddress, points[pointOf[2 * i + 1]], true);
    if (from >= 0) acc[from].trips++;
    if (to >= 0 && to !== from) acc[to].trips++;
    if (to >= 0 && i + 1 < trips.length && clusterOf(i + 1, false) === to) {
      const gap = (toDate(trips[i + 1].start).getTime() - toDate(t.end).getTime()) / 60000;
      if (gap >= 0 && gap <= MAX_DWELL_MIN) acc[to].dwell.push(gap);
    }
  });

  const entries = acc.map((a, c) => {
    const n = a.arrivals + a.departures;
    const address = mostFrequent(a.addresses);
    const parsed = parseAddress(address);
    const place: Place = {
      id: '',
      lat: n ? a.lat / n : centroids[c].lat,
      lon: n ? a.lon / n : centroids[c].lon,
      label: mostFrequent(a.labels) || '–',
      address,
      town: parsed.town,
      country: parsed.country,
      arrivals: a.arrivals,
      departures: a.departures,
      visits: Math.max(a.arrivals, a.departures),
      firstVisit: a.first,
      lastVisit: a.last,
      dwellMedianMin: median(a.dwell),
      tripShare: trips.length ? a.trips / trips.length : 0,
      isHome: false,
      isWork: false,
    };
    return { cluster: c, place };
  });
  entries.sort(
    (a, b) => b.place.visits - a.place.visits || b.place.arrivals - a.place.arrivals || a.place.label.localeCompare(b.place.label),
  );
  const places = entries.map((e) => e.place);
  const idOfCluster = new Map<number, string>();
  entries.forEach((e, i) => {
    e.place.id = `p${i + 1}`;
    idOfCluster.set(e.cluster, e.place.id);
  });
  const byId = new Map(places.map((p) => [p.id, p]));

  const assignments = new Map<string, TripPlaces>();
  trips.forEach((t, i) => {
    const from = clusterOf(i, false);
    const to = clusterOf(i, true);
    assignments.set(t.id, { from: from < 0 ? null : idOfCluster.get(from)!, to: to < 0 ? null : idOfCluster.get(to)! });
  });

  const { home, work } = detectHomeWork(trips, assignments, byId);
  if (home) home.isHome = true;
  if (work) work.isWork = true;
  return { places, byId, assignments, home, work };
}

/**
 * Home = where the last trip of a day ends most often (the car sleeps there),
 * work = non-home place with recurring weekday arrivals and a long stay in
 * working hours. Both are only reported when clearly ahead of the runner-up.
 */
export function detectHomeWork(
  sortedTrips: readonly Trip[],
  assignments: ReadonlyMap<string, TripPlaces>,
  byId: ReadonlyMap<string, Place>,
): { home: Place | null; work: Place | null } {
  const nights = new Map<string, number>();
  let days = 0;
  const lastOfDay = new Map<string, Trip>();
  for (const t of sortedTrips) lastOfDay.set(t.start.slice(0, 10), t);
  for (const t of lastOfDay.values()) {
    const to = assignments.get(t.id)?.to;
    if (!to) continue;
    days++;
    bump(nights, to);
  }
  const home = dominant(nights, (top, second) => top >= 3 && top >= days * 0.3 && top >= second * 1.5, byId);

  const workDays = new Map<string, Set<string>>();
  sortedTrips.forEach((t, i) => {
    const to = assignments.get(t.id)?.to;
    if (!to || to === home?.id) return;
    const arrival = toDate(t.end);
    const weekday = arrival.getDay();
    const hour = arrival.getHours() + arrival.getMinutes() / 60;
    if (weekday === 0 || weekday === 6 || hour < 6 || hour >= 20) return;
    const next = sortedTrips[i + 1];
    if (!next || assignments.get(next.id)?.from !== to) return;
    const dwellH = (toDate(next.start).getTime() - arrival.getTime()) / 3_600_000;
    if (dwellH < 4) return;
    let set = workDays.get(to);
    if (!set) workDays.set(to, (set = new Set()));
    set.add(t.end.slice(0, 10));
  });
  const counts = new Map([...workDays].map(([id, set]) => [id, set.size]));
  const work = dominant(counts, (top, second) => top >= 5 && top >= second * 1.5, byId);
  return { home, work };
}

function dominant(
  counts: ReadonlyMap<string, number>,
  accept: (top: number, second: number) => boolean,
  byId: ReadonlyMap<string, Place>,
): Place | null {
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  const second = ranked[1]?.[1] ?? 0;
  return accept(ranked[0][1], second) ? (byId.get(ranked[0][0]) ?? null) : null;
}
