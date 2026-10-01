import { describe, expect, it } from 'vitest';
import type { Trip } from '../domain/trip';
import { generateDemoTrips } from '../lib/demoData';
import { analyzePlaces, clusterPoints, haversineKm } from './places';
import { geography } from './placesGeography';
import { frequentRoutes } from './routes';

const HOME = { lat: 50.0, lon: 8.0, address: 'Heimweg 1, 11111 Hometown, Germany' };
const WORK = { lat: 50.05, lon: 8.1, address: 'Werkstr. 5, 22222 Worktown, Germany' };
const SHOP = { lat: 50.01, lon: 8.02, address: 'Marktplatz 3, 11111 Hometown, Germany' };
const FAR = { lat: 51.5, lon: 9.5, address: 'Fernweg 9, 33333 Farville, Austria' };

type Spot = typeof HOME;
const pad = (n: number) => String(n).padStart(2, '0');
// Deterministic few-metre jitter.
const jitter = (i: number) => ((i * 7919) % 11) * 0.00001;

function trip(i: number, day: string, startTime: string, endTime: string, from: Spot, to: Spot, extra: Partial<Trip> = {}): Trip {
  const start = `${day}T${startTime}`;
  return {
    id: `${start}|${i}`,
    start,
    end: `${day}T${endTime}`,
    startAddress: from.address,
    endAddress: to.address,
    distanceKm: 10,
    energyKwh: 2,
    category: 'Private',
    startLat: from.lat + jitter(i),
    startLon: from.lon + jitter(i + 1),
    endLat: to.lat + jitter(i + 2),
    endLon: to.lon + jitter(i + 3),
    startOdometerKm: i * 10,
    endOdometerKm: i * 10 + 10,
    tripType: 'SINGLE',
    socStart: 80,
    socEnd: 70,
    comment: '',
    ...extra,
  };
}

/** Three weeks of weekday commuting (Mon–Fri): home → work at 08:00, back at 17:00, plus a shop trip on Fridays. */
function commuter(): Trip[] {
  const out: Trip[] = [];
  let i = 0;
  for (let d = 1; d <= 21; d++) {
    const date = new Date(2025, 2, d); // March 2025 starts on Saturday
    const wd = date.getDay();
    if (wd === 0 || wd === 6) continue;
    const day = `2025-03-${pad(d)}`;
    out.push(trip(i++, day, '08:00', '08:30', HOME, WORK, { category: 'Business' }));
    out.push(trip(i++, day, '17:00', '17:30', WORK, HOME, { category: 'Business' }));
    if (wd === 5) {
      out.push(trip(i++, day, '18:30', '18:40', HOME, SHOP));
      out.push(trip(i++, day, '19:10', '19:20', SHOP, HOME));
    }
  }
  return out;
}

describe('clusterPoints', () => {
  it('merges jittered points and keeps distant ones apart', () => {
    const points = [HOME, WORK, HOME, SHOP, WORK, HOME].map((p, i) => ({ lat: p.lat + jitter(i), lon: p.lon + jitter(i) }));
    const { assignment, centroids } = clusterPoints(points);
    expect(centroids).toHaveLength(3);
    expect(assignment[0]).toBe(assignment[2]);
    expect(assignment[0]).toBe(assignment[5]);
    expect(assignment[1]).toBe(assignment[4]);
    expect(new Set(assignment).size).toBe(3);
  });

  it('handles an empty input', () => {
    expect(clusterPoints([])).toEqual({ assignment: [], centroids: [] });
  });

  it('keeps places 100 m and 400 m away apart as configured', () => {
    const base = { lat: 48, lon: 11 };
    const metres = (m: number) => ({ lat: base.lat + m / 111_320, lon: base.lon });
    const { assignment } = clusterPoints([base, metres(100), metres(400)]);
    expect(assignment[0]).toBe(assignment[1]);
    expect(assignment[2]).not.toBe(assignment[0]);
  });

  it('is fast for 20 000 endpoints', () => {
    const spots = Array.from({ length: 60 }, (_, i) => ({ lat: 50 + (i % 10) * 0.05, lon: 8 + Math.floor(i / 10) * 0.05 }));
    const points = Array.from({ length: 20_000 }, (_, i) => ({
      lat: spots[i % 60].lat + jitter(i),
      lon: spots[i % 60].lon + jitter(i * 3),
    }));
    const t0 = performance.now();
    const { centroids } = clusterPoints(points);
    expect(centroids.length).toBeLessThan(100);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe('analyzePlaces', () => {
  const trips = commuter();
  const result = analyzePlaces(trips);

  it('finds the three places sorted by visits', () => {
    expect(result.places).toHaveLength(3);
    const [a, b, c] = result.places;
    expect(a.visits).toBeGreaterThanOrEqual(b.visits);
    expect(b.visits).toBeGreaterThan(c.visits);
    expect(c.label).toBe('Marktplatz 3, Hometown');
    expect(c.town).toBe('Hometown');
    expect(c.country).toBe('Germany');
  });

  it('computes visits, dwell time and share of trips', () => {
    const work = result.places.find((p) => p.label.startsWith('Werkstr'))!;
    expect(work.arrivals).toBe(15);
    expect(work.departures).toBe(15);
    // 08:30 → 17:00 on every workday.
    expect(work.dwellMedianMin).toBe(510);
    expect(work.firstVisit).toBe('2025-03-03T08:30');
    expect(work.lastVisit).toBe('2025-03-21T17:00');
    expect(work.tripShare).toBeCloseTo(30 / trips.length, 5);
  });

  it('detects home and work', () => {
    expect(result.home?.label).toBe('Heimweg 1, Hometown');
    expect(result.work?.label).toBe('Werkstr. 5, Worktown');
    expect(result.places.filter((p) => p.isHome)).toHaveLength(1);
    expect(result.places.filter((p) => p.isWork)).toHaveLength(1);
  });

  it('reports no home or work when nothing dominates', () => {
    const spot = (k: number): Spot => ({ ...SHOP, lat: SHOP.lat + k * 0.05 });
    const scattered = Array.from({ length: 8 }, (_, i) => trip(i, `2025-03-${pad(i + 3)}`, '10:00', '10:30', spot(i), spot(i + 1)));
    const r = analyzePlaces(scattered);
    expect(r.home).toBeNull();
    expect(r.work).toBeNull();
  });

  it('does not call a weekend destination work', () => {
    const weekend: Trip[] = [];
    // Saturdays in March 2025: 1, 8, 15, 22, 29
    [1, 8, 15, 22, 29, 3, 10].forEach((d, k) => {
      weekend.push(trip(2 * k, `2025-03-${pad(d)}`, '08:00', '08:30', HOME, WORK));
      weekend.push(trip(2 * k + 1, `2025-03-${pad(d)}`, '17:00', '17:30', WORK, HOME));
    });
    expect(analyzePlaces(weekend).work).toBeNull();
  });

  it('assigns every trip to places', () => {
    const a = result.assignments.get(trips[0].id)!;
    expect(a.from).toBe(result.home!.id);
    expect(a.to).toBe(result.work!.id);
  });

  it('ignores endpoints without coordinates', () => {
    const t = trip(0, '2025-03-03', '08:00', '08:30', HOME, WORK, { startLat: null, startLon: null, endLat: 0, endLon: 0 });
    const r = analyzePlaces([t]);
    expect(r.places).toHaveLength(0);
    expect(r.assignments.get(t.id)).toEqual({ from: null, to: null });
  });

  it('works for the generated demo data', () => {
    const demo = generateDemoTrips({ endDate: new Date(2025, 5, 30), days: 120 });
    const r = analyzePlaces(demo);
    expect(r.places.length).toBeGreaterThanOrEqual(6);
    expect(r.places.length).toBeLessThan(15);
    expect(r.home?.town).toBe('Göteborg');
    expect(r.work).not.toBeNull();
  });

  it('handles 10 000 trips quickly', () => {
    const demo = generateDemoTrips({ endDate: new Date(2025, 5, 30), days: 365 });
    const many: Trip[] = [];
    for (let k = 0; many.length < 10_000; k++) {
      for (const t of demo)
        many.push({
          ...t,
          id: `${t.id}#${k}`,
          start: t.start.replace(/^\d{4}/, String(1900 + k)),
          end: t.end.replace(/^\d{4}/, String(1900 + k)),
        });
    }
    const t0 = performance.now();
    const r = analyzePlaces(many);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(r.places.length).toBeLessThan(20);
  });
});

describe('frequentRoutes', () => {
  const trips = commuter();
  const { assignments, home, work } = analyzePlaces(trips);

  it('counts directed routes with averages', () => {
    const routes = frequentRoutes(trips, assignments);
    const out = routes.find((r) => r.from === home!.id && r.to === work!.id)!;
    expect(out.count).toBe(15);
    expect(out.directed).toBe(true);
    expect(out.avgDistanceKm).toBe(10);
    expect(out.consumption).toBeCloseTo(20, 5);
    expect(out.avgDurationMin).toBe(30);
  });

  it('merges both directions when combined', () => {
    const routes = frequentRoutes(trips, assignments, { combined: true });
    const pair = routes.find((r) => [r.from, r.to].sort().join() === [home!.id, work!.id].sort().join())!;
    expect(pair.count).toBe(30);
    expect(pair.directed).toBe(false);
    expect(routes).toHaveLength(2);
  });

  it('skips loops, minCount and trips without energy in the consumption', () => {
    const noEnergy = trips.map((t, i) => (i === 0 ? { ...t, energyKwh: null } : t));
    const routes = frequentRoutes(noEnergy, analyzePlaces(noEnergy).assignments, { minCount: 16 });
    expect(routes).toHaveLength(0);
    const all = frequentRoutes(noEnergy, analyzePlaces(noEnergy).assignments);
    expect(all[0].consumption).toBeCloseTo(20, 5);
  });
});

describe('geography', () => {
  it('collects countries, towns, bounds and the farthest point from home', () => {
    const trips = [
      ...commuter(),
      trip(900, '2025-03-22', '10:00', '13:00', HOME, FAR),
      trip(901, '2025-03-22', '16:00', '19:00', FAR, HOME),
    ];
    const { places, home, work } = analyzePlaces(trips);
    const g = geography(trips, places, home, work);
    expect(g.uniquePlaces).toBe(4);
    expect(g.countries.map((c) => c.name).sort()).toEqual(['Austria', 'Germany']);
    expect(g.towns.map((t) => t.name)).toEqual(expect.arrayContaining(['Hometown', 'Worktown', 'Farville']));
    expect(g.farthest?.place.town).toBe('Farville');
    expect(g.farthest!.distanceKm).toBeCloseTo(haversineKm(HOME.lat, HOME.lon, FAR.lat, FAR.lon), 0);
    expect(g.bounds![3]).toBeCloseTo(FAR.lat, 2);
    expect(g.homeToWorkKm).toBeCloseTo(haversineKm(HOME.lat, HOME.lon, WORK.lat, WORK.lon), 0);
  });

  it('has no farthest point or bounds without coordinates', () => {
    const g = geography([], [], null, null);
    expect(g.farthest).toBeNull();
    expect(g.bounds).toBeNull();
    expect(g.homeToWorkKm).toBeNull();
  });
});
