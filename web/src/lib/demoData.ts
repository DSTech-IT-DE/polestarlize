import { tripId, type Trip } from '../domain/trip';

/**
 * Generates a plausible, fully synthetic year of Journey Log data around
 * Gothenburg so the app can be explored without uploading anything.
 */

interface Place {
  address: string;
  lat: number;
  lon: number;
}

const HOME: Place = { address: 'Vasagatan 12, 411 24 Göteborg, Sweden', lat: 57.7009, lon: 11.9685 };
const PLACES: Place[] = [
  { address: 'Torslandavägen 2, 423 37 Torslanda, Sweden', lat: 57.7205, lon: 11.7797 },
  { address: 'Nordstadstorget 1, 411 05 Göteborg, Sweden', lat: 57.7089, lon: 11.9699 },
  { address: 'Frölunda Torg 4, 421 42 Västra Frölunda, Sweden', lat: 57.6526, lon: 11.9109 },
  { address: 'Mölndalsvägen 91, 412 63 Göteborg, Sweden', lat: 57.6855, lon: 11.9985 },
  { address: 'Hamngatan 5, 442 31 Kungälv, Sweden', lat: 57.8712, lon: 11.9776 },
  { address: 'Stora Torget 1, 451 30 Uddevalla, Sweden', lat: 58.3498, lon: 11.9381 },
  { address: 'Storgatan 20, 432 41 Varberg, Sweden', lat: 57.1057, lon: 12.2508 },
  { address: 'Drottninggatan 2, 252 21 Helsingborg, Sweden', lat: 56.0465, lon: 12.6945 },
];
const WORK = PLACES[0];

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function haversineKm(a: Place, b: Place): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const pad = (n: number) => String(n).padStart(2, '0');
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function generateDemoTrips(options: { endDate?: Date; days?: number; seed?: number } = {}): Trip[] {
  const random = mulberry32(options.seed ?? 42);
  const days = options.days ?? 365;
  const endDate = options.endDate ?? new Date();
  const capacityStart = 79;
  let odometer = 18_000;
  let soc = 80;
  let position = HOME;
  const trips: Trip[] = [];

  for (let day = days; day >= 0; day--) {
    const date = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - day);
    const weekday = date.getDay();
    const month = date.getMonth();
    // Colder months cost more energy.
    const seasonal = 1 + 0.28 * Math.cos(((month + 0.5) / 12) * 2 * Math.PI);
    // Slow, slightly noisy capacity fade of about 2 % per year.
    const capacity = capacityStart * (1 - 0.02 * ((days - day) / 365));

    const plan: Place[] = [];
    if (weekday >= 1 && weekday <= 5 && random() < 0.85) {
      plan.push(WORK);
      if (random() < 0.3) plan.push(PLACES[1 + Math.floor(random() * 3)]);
      plan.push(HOME);
    } else if (random() < 0.7) {
      const far = random() < 0.3;
      plan.push(far ? PLACES[4 + Math.floor(random() * 4)] : PLACES[1 + Math.floor(random() * 3)]);
      plan.push(HOME);
    }

    let hour = weekday >= 1 && weekday <= 5 ? 7 + random() * 1.5 : 10 + random() * 3;
    for (const target of plan) {
      if (target === position) continue;
      const distance = Math.max(1, Math.round(haversineKm(position, target) * (1.25 + random() * 0.15)));
      const speed = distance > 60 ? 85 + random() * 20 : 28 + random() * 14;
      const minutes = Math.max(3, Math.round((distance / speed) * 60));
      const perKm = (0.155 + random() * 0.04) * seasonal * (distance > 60 ? 1.12 : 1);
      const energy = Math.round(distance * perKm * 1000) / 1000;
      let socDrop = Math.round((energy / capacity) * 100);
      if (soc - socDrop < 12) {
        // Fast charge on the way.
        soc = Math.min(95, Math.max(soc + 60, socDrop + 15));
      }
      socDrop = Math.min(socDrop, soc - 5);
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(hour), Math.floor((hour % 1) * 60));
      const end = new Date(start.getTime() + minutes * 60000);
      const startOdometerKm = odometer;
      odometer += distance;
      trips.push({
        id: tripId(local(start), startOdometerKm),
        start: local(start),
        end: local(end),
        startAddress: position.address,
        endAddress: target.address,
        distanceKm: distance,
        energyKwh: energy,
        category: target === WORK || position === WORK ? 'Business' : 'Private',
        startLat: position.lat + (random() - 0.5) * 0.0004,
        startLon: position.lon + (random() - 0.5) * 0.0004,
        endLat: target.lat + (random() - 0.5) * 0.0004,
        endLon: target.lon + (random() - 0.5) * 0.0004,
        startOdometerKm,
        endOdometerKm: odometer,
        tripType: 'SINGLE',
        socStart: soc,
        socEnd: soc - socDrop,
        comment: '',
      });
      soc -= socDrop;
      position = target;
      hour += minutes / 60 + (target === WORK ? 8.5 + random() : 0.5 + random() * 2.5);
    }
    // Overnight: small standby drain, charge at home when low.
    soc = Math.max(5, soc - (random() < 0.5 ? 1 : 0));
    if (position === HOME && soc < 55 + random() * 15) soc = random() < 0.8 ? 80 : 90;
  }
  return trips.reverse();
}
