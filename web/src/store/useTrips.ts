import { useLiveQuery } from 'dexie-react-hooks';
import type { StoredTrip } from '../domain/trip';
import { db, type ImportRecord } from './db';

/** All stored trips, oldest first. `undefined` while loading. */
export function useAllTrips(): StoredTrip[] | undefined {
  return useLiveQuery(() => db.trips.orderBy('start').toArray(), []);
}

export function useImports(): ImportRecord[] | undefined {
  return useLiveQuery(() => db.imports.orderBy('importedAt').reverse().toArray(), []);
}
