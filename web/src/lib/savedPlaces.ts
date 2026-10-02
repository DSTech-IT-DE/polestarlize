import { distanceMeters } from '../analytics/stints';

/**
 * Places the user described: what they are (home, work, …) and what a kWh
 * costs there. Stored by position, not by the ids of an analysis, because
 * clusters and their ids change with every period and import.
 */
export type PlaceKind = 'home' | 'work' | 'other';

export interface SavedPlace {
  id: string;
  lat: number;
  lon: number;
  /** `null` = only a price was set, the kind is still detected. */
  kind: PlaceKind | null;
  /** Price per kWh drawn from the grid there; `null` = default price of the kind. */
  price: number | null;
  /** Address when it was saved, to recognise the place in a backup or settings list. */
  label: string;
}

/** A saved place applies to everything within this distance; a bit more than the clustering radii, since cluster centres move. */
export const SAVED_PLACE_RADIUS_M = 250;
// Keeps the synced settings well below the server's size limit.
const MAX_SAVED_PLACES = 50;
const KINDS: readonly PlaceKind[] = ['home', 'work', 'other'];

/** Nearest saved place within the radius, or null. */
export function matchSavedPlace(lat: number | null, lon: number | null, places: readonly SavedPlace[], radiusM = SAVED_PLACE_RADIUS_M): SavedPlace | null {
  if (lat == null || lon == null) return null;
  let best: SavedPlace | null = null;
  let bestM = radiusM;
  for (const p of places) {
    const m = distanceMeters(lat, lon, p.lat, p.lon);
    if (m <= bestM) {
      best = p;
      bestM = m;
    }
  }
  return best;
}

/**
 * Returns the list with the place at `position` changed. A new entry is created
 * when no saved place is near; an entry without kind and price is dropped.
 */
export function withSavedPlace(
  places: readonly SavedPlace[],
  position: { lat: number; lon: number; label: string; savedId?: string },
  patch: Partial<Pick<SavedPlace, 'kind' | 'price'>>,
): SavedPlace[] {
  const existing = position.savedId ? places.find((p) => p.id === position.savedId) : undefined;
  const base: SavedPlace = existing ?? { id: newId(), lat: position.lat, lon: position.lon, kind: null, price: null, label: position.label };
  const next = { ...base, ...patch };
  const rest = places.filter((p) => p.id !== base.id);
  return next.kind == null && next.price == null ? rest : [...rest, next];
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/** Validates places coming from a sync server or a backup file. Invalid entries are dropped. */
export function sanitizeSavedPlaces(value: unknown): SavedPlace[] | null {
  if (!Array.isArray(value)) return null;
  const result: SavedPlace[] = [];
  for (const item of value.slice(0, MAX_SAVED_PLACES)) {
    if (typeof item !== 'object' || item === null) continue;
    const v = item as Record<string, unknown>;
    const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
    if (typeof v.id !== 'string' || !finite(v.lat) || !finite(v.lon) || Math.abs(v.lat) > 90 || Math.abs(v.lon) > 180) continue;
    const kind = KINDS.includes(v.kind as PlaceKind) ? (v.kind as PlaceKind) : null;
    const price = finite(v.price) && v.price >= 0 ? v.price : null;
    if (kind == null && price == null) continue;
    result.push({ id: v.id.slice(0, 64), lat: v.lat, lon: v.lon, kind, price, label: typeof v.label === 'string' ? v.label.slice(0, 200) : '' });
  }
  return result;
}
