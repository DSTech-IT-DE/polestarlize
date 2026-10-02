import { tripCheck } from '../analytics/plausibility';
import type { StoredTrip, Trip, TripReview } from '../domain/trip';
import { combineIncoming, planMerge, type MergeStats } from '../import/merge';
import { generateDemoTrips } from '../lib/demoData';
import { acceptRemoteSettings, getSettings, syncedSettings, updateSettings } from '../lib/settings';
import { db, type ImportRecord } from './db';

export interface ImportSummary extends MergeStats {
  skipped: number;
  total: number;
  /** New or changed trips that look like faulty recordings and wait for a review. */
  flagged: number;
}

type ChangeListener = () => void;
const listeners = new Set<ChangeListener>();

/** Notified after every local write, e.g. to trigger a sync. */
export function onLocalChange(listener: ChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) listener();
}

function stored(trip: Trip, now: string): StoredTrip {
  return { ...trip, updatedAt: now, dirty: 1 };
}

export function stripStorage({ updatedAt: _u, dirty: _d, ...trip }: StoredTrip): Trip {
  return trip;
}

/** Folds parsed export files into the local database. */
export async function importTrips(files: { fileName: string; trips: Trip[]; skipped: number }[]): Promise<ImportSummary> {
  const incoming = combineIncoming(files.map((f) => f.trips));
  const skipped = files.reduce((sum, f) => sum + f.skipped, 0);
  const now = new Date().toISOString();

  const stats = await db.transaction('rw', db.trips, db.tombstones, db.imports, async () => {
    const existing = (await db.trips.toArray()).map(stripStorage);
    const plan = planMerge(existing, incoming);
    await db.trips.bulkPut(plan.put.map((t) => stored(t, now)));
    await db.trips.bulkDelete(plan.remove);
    await db.tombstones.bulkPut(plan.remove.map((id) => ({ id, deletedAt: now })));
    await db.tombstones.bulkDelete(plan.put.map((t) => t.id));
    const starts = incoming.map((t) => t.start).sort();
    const record: ImportRecord = {
      importedAt: now,
      fileNames: files.map((f) => f.fileName),
      ...plan.stats,
      skipped,
      firstTrip: starts[0] ?? null,
      lastTrip: starts[starts.length - 1] ?? null,
    };
    await db.imports.add(record);
    const options = { capacityKwh: getSettings().usableCapacityKwh };
    const flagged = plan.put.filter((t) => tripCheck(t, options).status === 'review').length;
    return { ...plan.stats, flagged };
  });
  notify();
  return { ...stats, skipped, total: await db.trips.count() };
}

/** Records whether trips count in the analyses; `undefined` leaves it to the plausibility check again. */
export async function setTripReview(ids: readonly string[], review: TripReview | undefined): Promise<void> {
  const now = new Date().toISOString();
  await db.trips
    .where('id')
    .anyOf([...ids])
    .modify((trip) => {
      if (review) trip.review = review;
      else delete trip.review;
      trip.updatedAt = now;
      trip.dirty = 1;
    });
  notify();
}

export async function loadDemoData(): Promise<ImportSummary> {
  return importTrips([{ fileName: 'demo-data', trips: generateDemoTrips(), skipped: 0 }]);
}

/** Removes every trip locally; with `propagate` the deletions are synced to the server as well. */
export async function deleteAllTrips(options: { propagate: boolean }): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction('rw', db.trips, db.tombstones, db.imports, async () => {
    if (options.propagate) {
      const ids = await db.trips.toCollection().primaryKeys();
      await db.tombstones.bulkPut(ids.map((id) => ({ id, deletedAt: now })));
    } else {
      await db.tombstones.clear();
    }
    await db.trips.clear();
    await db.imports.clear();
  });
  if (options.propagate) notify();
}

export interface Backup {
  format: 'polestarlize-backup';
  /** 2 added `settings`, with the charging places. Version 1 files are still read. */
  version: 1 | 2;
  userId: string;
  exportedAt: string;
  trips: Trip[];
  imports: ImportRecord[];
  /** Synced settings: prices, vehicle, charging places … Device-only settings are left out. */
  settings?: Record<string, unknown>;
}

export async function createBackup(userId: string): Promise<Backup> {
  return {
    format: 'polestarlize-backup',
    version: 2,
    userId,
    exportedAt: new Date().toISOString(),
    trips: (await db.trips.toArray()).map(stripStorage),
    imports: await db.imports.toArray(),
    settings: syncedSettings(getSettings()),
  };
}

export function isBackup(value: unknown): value is Backup {
  const v = value as Backup;
  return !!v && v.format === 'polestarlize-backup' && Array.isArray(v.trips);
}

export async function restoreBackup(backup: Backup): Promise<ImportSummary> {
  // Settings first, so the plausibility check of the import already uses the restored capacity.
  if (backup.settings && typeof backup.settings === 'object') updateSettings(acceptRemoteSettings(backup.settings));
  return importTrips([{ fileName: 'backup', trips: backup.trips, skipped: 0 }]);
}
