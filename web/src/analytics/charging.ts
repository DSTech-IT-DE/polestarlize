import { matchSavedPlace, type PlaceKind, type SavedPlace } from '../lib/savedPlaces';
import { median } from './core';
import { distanceMeters, shortAddress, type Stint } from './stints';

/** A parked stint must gain at least this many SOC points to count as a charge (1–2 points are rounding and wake-ups). */
export const MIN_CHARGE_GAIN = 3;
/** Stints shorter than this are too short to measure standby drain through integer SOC values. */
export const MIN_STANDBY_HOURS = 6;
/** Charging sessions within this radius belong to the same place. */
export const PLACE_RADIUS_M = 200;
/** A place is only called "home" when it holds more than this share of all sessions. */
export const HOME_SESSION_SHARE = 0.4;

export interface ChargingSession extends Stint {
  /** SOC points gained while parked (≥ `MIN_CHARGE_GAIN`). */
  gain: number;
  /** Battery-side energy estimate: gain × capacity / 100. Grid losses are not included. */
  energyKwh: number;
  /** `YYYY-MM` of the start of the parking window. */
  month: string;
}

/**
 * Stints with a clear SOC gain and no missing trips in between. The real charging
 * duration is unknown: `from`/`to` only bound the time the car stood there.
 */
export function chargingSessions(stints: readonly Stint[], capacityKwh: number): ChargingSession[] {
  return stints
    .filter((s) => s.delta >= MIN_CHARGE_GAIN && !s.odometerGap)
    .map((s) => ({ ...s, gain: s.delta, energyKwh: (s.delta * capacityKwh) / 100, month: s.from.slice(0, 7) }));
}

export interface ChargingStats {
  sessions: number;
  sessionsPerWeek: number | null;
  energyKwh: number;
  avgSocBefore: number | null;
  avgSocAfter: number | null;
  /** Share of sessions that ended at 90 % or more, 0..1. */
  shareTo90: number | null;
  avgGain: number | null;
  medianGain: number | null;
}

export function chargingStats(sessions: readonly ChargingSession[], spanDays: number): ChargingStats {
  const n = sessions.length;
  const sum = (pick: (s: ChargingSession) => number) => sessions.reduce((a, s) => a + pick(s), 0);
  return {
    sessions: n,
    sessionsPerWeek: n > 0 && spanDays > 0 ? n / (spanDays / 7) : null,
    energyKwh: sum((s) => s.energyKwh),
    avgSocBefore: n ? sum((s) => s.socBefore) / n : null,
    avgSocAfter: n ? sum((s) => s.socAfter) / n : null,
    shareTo90: n ? sessions.filter((s) => s.socAfter >= 90).length / n : null,
    avgGain: n ? sum((s) => s.gain) / n : null,
    medianGain: median(sessions.map((s) => s.gain)),
  };
}

export interface MonthlyCharging {
  key: string;
  sessions: number;
  energyKwh: number;
}

/** Sessions and energy per month for the given month keys (so empty months show as zero). */
export function monthlyCharging(sessions: readonly ChargingSession[], months: readonly string[]): MonthlyCharging[] {
  const map = new Map<string, MonthlyCharging>(months.map((key) => [key, { key, sessions: 0, energyKwh: 0 }]));
  for (const s of sessions) {
    const m = map.get(s.month);
    if (!m) continue;
    m.sessions++;
    m.energyKwh += s.energyKwh;
  }
  return [...map.values()];
}

/** Counts per `width`-wide bin starting at 0; values of `max` fall into the last bin. */
export function histogram(values: readonly number[], width: number, max = 100): number[] {
  const bins = Math.ceil(max / width);
  const counts = new Array<number>(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.max(0, Math.floor(v / width)))]++;
  return counts;
}

export interface ChargingPlace {
  id: string;
  lat: number | null;
  lon: number | null;
  /** Most common short address of the sessions, empty when unknown. */
  label: string;
  sessions: number;
  energyKwh: number;
  avgSocBefore: number;
  avgSocAfter: number;
  /** Share of all sessions / of all estimated energy, 0..1. */
  shareOfSessions: number;
  shareOfEnergy: number;
  /** Most used place, flagged only when it holds more than `HOME_SESSION_SHARE` of the sessions and the user marked no home. */
  likelyHome: boolean;
  /** The user's description of this place, if any. */
  saved: SavedPlace | null;
  /** `from` of the member sessions, to look up which place a session belongs to. */
  sessionKeys: string[];
}

function mostCommon(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = '';
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Sessions near a place the user saved belong to that place. The rest is
 * clustered greedily by frequency: the session with the most neighbours inside
 * the radius becomes a place together with those neighbours, repeat with the
 * rest. Sessions without coordinates end up in one place without a position.
 */
export function chargingPlaces(sessions: readonly ChargingSession[], saved: readonly SavedPlace[] = [], radiusM = PLACE_RADIUS_M): ChargingPlace[] {
  const groups: { members: ChargingSession[]; located: boolean; saved: SavedPlace | null }[] = [];
  const bySaved = new Map<SavedPlace, ChargingSession[]>();
  const rest: ChargingSession[] = [];
  for (const s of sessions) {
    const match = matchSavedPlace(s.lat, s.lon, saved);
    if (!match) rest.push(s);
    else if (bySaved.has(match)) bySaved.get(match)!.push(s);
    else bySaved.set(match, [s]);
  }
  for (const [place, members] of bySaved) groups.push({ members, located: true, saved: place });

  const located = rest.filter((s) => s.lat != null && s.lon != null);
  const unlocated = rest.filter((s) => s.lat == null || s.lon == null);
  const neighbours: number[][] = located.map(() => []);
  for (let i = 0; i < located.length; i++) {
    for (let j = i + 1; j < located.length; j++) {
      if (distanceMeters(located[i].lat!, located[i].lon!, located[j].lat!, located[j].lon!) <= radiusM) {
        neighbours[i].push(j);
        neighbours[j].push(i);
      }
    }
  }
  const assigned = new Array<boolean>(located.length).fill(false);
  for (;;) {
    let best = -1;
    let bestCount = -1;
    for (let i = 0; i < located.length; i++) {
      if (assigned[i]) continue;
      const count = neighbours[i].filter((j) => !assigned[j]).length;
      if (count > bestCount) {
        best = i;
        bestCount = count;
      }
    }
    if (best < 0) break;
    const ids = [best, ...neighbours[best].filter((j) => !assigned[j])];
    for (const i of ids) assigned[i] = true;
    groups.push({ members: ids.map((i) => located[i]), located: true, saved: null });
  }
  if (unlocated.length) groups.push({ members: unlocated, located: false, saved: null });

  const totalSessions = sessions.length;
  const totalEnergy = sessions.reduce((a, s) => a + s.energyKwh, 0);
  const places = groups.map((g, index): ChargingPlace => {
    const n = g.members.length;
    const energyKwh = g.members.reduce((a, s) => a + s.energyKwh, 0);
    return {
      id: `p${index}`,
      // A saved place keeps its own position, so it is found again in every period.
      lat: g.saved ? g.saved.lat : g.located ? g.members.reduce((a, s) => a + s.lat!, 0) / n : null,
      lon: g.saved ? g.saved.lon : g.located ? g.members.reduce((a, s) => a + s.lon!, 0) / n : null,
      label: shortAddress(mostCommon(g.members.map((s) => s.address))),
      sessions: n,
      energyKwh,
      avgSocBefore: g.members.reduce((a, s) => a + s.socBefore, 0) / n,
      avgSocAfter: g.members.reduce((a, s) => a + s.socAfter, 0) / n,
      shareOfSessions: totalSessions ? n / totalSessions : 0,
      shareOfEnergy: totalEnergy ? energyKwh / totalEnergy : 0,
      likelyHome: false,
      saved: g.saved,
      sessionKeys: g.members.map((s) => s.from),
    };
  });
  places.sort((a, b) => b.sessions - a.sessions || b.energyKwh - a.energyKwh);
  const top = places.find((p) => p.lat != null);
  const homeKnown = saved.some((p) => p.kind === 'home');
  if (!homeKnown && top && top === places[0] && !top.saved?.kind && top.shareOfSessions > HOME_SESSION_SHARE) top.likelyHome = true;
  return places.map((p, i) => ({ ...p, id: `p${i}` }));
}

/** What the place is: as marked by the user, else `home` for the detected home, else null. */
export function placeKind(place: Pick<ChargingPlace, 'saved' | 'likelyHome'>): PlaceKind | null {
  return place.saved?.kind ?? (place.likelyHome ? 'home' : null);
}

export interface PlacePrices {
  homePrice: number;
  publicPrice: number;
}

/** Price per kWh from the grid at a place: its own price, else the home price at home and the public price anywhere else. */
export function placePrice(place: Pick<ChargingPlace, 'saved' | 'likelyHome'>, prices: PlacePrices): number {
  if (place.saved?.price != null) return place.saved.price;
  return placeKind(place) === 'home' ? prices.homePrice : prices.publicPrice;
}

export interface PriceMix {
  /** Estimated battery-side energy of all sessions. */
  energyKwh: number;
  /** Energy-weighted average price per kWh from the grid, null without sessions. */
  price: number | null;
  /** Share of the energy charged at places of kind home, 0..1. */
  homeShare: number | null;
}

/** Average price of the energy actually charged, weighted by how much was charged where. */
export function priceMix(places: readonly ChargingPlace[], prices: PlacePrices): PriceMix {
  let energy = 0;
  let cost = 0;
  let home = 0;
  for (const p of places) {
    energy += p.energyKwh;
    cost += p.energyKwh * placePrice(p, prices);
    if (placeKind(p) === 'home') home += p.energyKwh;
  }
  return { energyKwh: energy, price: energy > 0 ? cost / energy : null, homeShare: energy > 0 ? home / energy : null };
}

export interface StandbyDrain {
  /** Stints that qualify: not a charge, no missing trips, parked long enough. */
  stints: number;
  totalDays: number;
  /** Total SOC points lost / total parked days: robust against integer rounding of single stints. */
  pooledPctPerDay: number | null;
  /** Median of the per-stint rates. */
  medianPctPerDay: number | null;
  pooledKwhPerDay: number | null;
  medianKwhPerDay: number | null;
  /** Per-stint rates in %/day, for the distribution. Slightly negative values are rounding noise. */
  rates: number[];
}

/**
 * SOC lost while parked without charging. The figure includes everything the car
 * does on its own: climate pre-conditioning, app wake-ups, sentry-like features.
 *
 * Stints with a gain of 1–2 points are kept (as slightly negative loss) instead of
 * dropped: they are rounding noise, and discarding only that side would bias the
 * average upwards.
 */
export function standbyDrain(stints: readonly Stint[], capacityKwh: number): StandbyDrain {
  const used = stints.filter((s) => s.delta < MIN_CHARGE_GAIN && !s.odometerGap && s.parkedMinutes >= MIN_STANDBY_HOURS * 60);
  const rates = used.map((s) => -s.delta / (s.parkedMinutes / 1440));
  const totalDays = used.reduce((a, s) => a + s.parkedMinutes / 1440, 0);
  const totalLoss = used.reduce((a, s) => a - s.delta, 0);
  const pooled = totalDays > 0 ? totalLoss / totalDays : null;
  const med = median(rates);
  const medianRate = med == null ? null : med + 0; // normalises -0
  const kwh = (pct: number | null) => (pct == null ? null : (pct * capacityKwh) / 100);
  return {
    stints: used.length,
    totalDays,
    pooledPctPerDay: pooled,
    medianPctPerDay: medianRate,
    pooledKwhPerDay: kwh(pooled),
    medianKwhPerDay: kwh(medianRate),
    rates,
  };
}

export interface EnergyBalance {
  /** Energy the trips report. */
  usedKwh: number;
  /** SOC-based estimate of energy charged (battery side). */
  chargedKwh: number;
  /** SOC-based estimate of standby losses. */
  standbyKwh: number;
  stints: number;
  /** Stints skipped because trips are missing in between. */
  gapStints: number;
}

export function energyBalance(usedKwh: number, stints: readonly Stint[], sessions: readonly ChargingSession[], capacityKwh: number): EnergyBalance {
  const standbyPoints = stints.filter((s) => s.delta < 0 && !s.odometerGap).reduce((a, s) => a - s.delta, 0);
  return {
    usedKwh,
    chargedKwh: sessions.reduce((a, s) => a + s.energyKwh, 0),
    standbyKwh: (standbyPoints * capacityKwh) / 100,
    stints: stints.length,
    gapStints: stints.filter((s) => s.odometerGap).length,
  };
}
