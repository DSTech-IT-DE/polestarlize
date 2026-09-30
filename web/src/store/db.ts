import Dexie, { type Table } from 'dexie';
import type { StoredTrip } from '../domain/trip';

export interface ImportRecord {
  id?: number;
  importedAt: string;
  fileNames: string[];
  added: number;
  updated: number;
  unchanged: number;
  replaced: number;
  skipped: number;
  /** First and last trip start in the imported files. */
  firstTrip: string | null;
  lastTrip: string | null;
}

export interface Tombstone {
  id: string;
  deletedAt: string;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

class PolestarlizeDb extends Dexie {
  trips!: Table<StoredTrip, string>;
  tombstones!: Table<Tombstone, string>;
  imports!: Table<ImportRecord, number>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super('polestarlize');
    this.version(1).stores({
      trips: 'id, start, dirty',
      tombstones: 'id',
      imports: '++id, importedAt',
      meta: 'key',
    });
  }
}

export const db = new PolestarlizeDb();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
