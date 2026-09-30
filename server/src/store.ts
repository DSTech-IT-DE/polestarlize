import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { LIMITS, type SettingsPayload, type SyncRequest, type Trip } from './validation.ts';

export interface SyncResult {
  rev: number;
  trips: Trip[];
  deleted: string[];
  settings?: SettingsPayload;
}

export class VaultLimitError extends Error {}

/** The raw user ID is never stored; vaults are addressed by the SHA-256 of the lower-cased UUID. */
export function vaultKey(userId: string): string {
  return createHash('sha256').update(userId.toLowerCase()).digest('hex');
}

interface VaultRow {
  rev: number;
  settings_json: string | null;
  settings_updated_at: string | null;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS vaults (
    key TEXT PRIMARY KEY,
    rev INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    settings_json TEXT,
    settings_updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS trips (
    vault_key TEXT NOT NULL,
    id TEXT NOT NULL,
    rev INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    data_json TEXT,
    PRIMARY KEY (vault_key, id)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS trips_by_rev ON trips (vault_key, rev);
`;

export class Store {
  private readonly db: DatabaseSync;
  private readonly getVault: StatementSync;
  private readonly insertVault: StatementSync;
  private readonly touchVault: StatementSync;
  private readonly saveSettings: StatementSync;
  private readonly upsertTrip: StatementSync;
  private readonly tombstoneTrip: StatementSync;
  private readonly countTrips: StatementSync;
  private readonly changedTrips: StatementSync;
  private readonly changedTombstones: StatementSync;
  private readonly removeTrips: StatementSync;
  private readonly removeVault: StatementSync;

  private readonly maxTrips: number;

  /** `location` is a file path or `:memory:`. */
  constructor(location: string, options: { maxTripsPerVault?: number } = {}) {
    this.maxTrips = options.maxTripsPerVault ?? LIMITS.maxTripsPerVault;
    if (location !== ':memory:') mkdirSync(dirname(location), { recursive: true });
    this.db = new DatabaseSync(location);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);

    this.getVault = this.db.prepare('SELECT rev, settings_json, settings_updated_at FROM vaults WHERE key = ?');
    this.insertVault = this.db.prepare('INSERT OR IGNORE INTO vaults (key, rev, created_at, updated_at) VALUES (?, 0, ?, ?)');
    this.touchVault = this.db.prepare('UPDATE vaults SET rev = ?, updated_at = ? WHERE key = ?');
    this.saveSettings = this.db.prepare('UPDATE vaults SET settings_json = ?, settings_updated_at = ? WHERE key = ?');
    this.upsertTrip = this.db.prepare(
      `INSERT INTO trips (vault_key, id, rev, deleted, data_json) VALUES (?, ?, ?, 0, ?)
       ON CONFLICT (vault_key, id) DO UPDATE SET rev = excluded.rev, deleted = 0, data_json = excluded.data_json`,
    );
    this.tombstoneTrip = this.db.prepare(
      `INSERT INTO trips (vault_key, id, rev, deleted, data_json) VALUES (?, ?, ?, 1, NULL)
       ON CONFLICT (vault_key, id) DO UPDATE SET rev = excluded.rev, deleted = 1, data_json = NULL`,
    );
    this.countTrips = this.db.prepare('SELECT COUNT(*) AS n FROM trips WHERE vault_key = ? AND deleted = 0');
    this.changedTrips = this.db.prepare('SELECT data_json FROM trips WHERE vault_key = ? AND deleted = 0 AND rev > ? ORDER BY rev, id');
    this.changedTombstones = this.db.prepare('SELECT id FROM trips WHERE vault_key = ? AND deleted = 1 AND rev > ? ORDER BY rev, id');
    this.removeTrips = this.db.prepare('DELETE FROM trips WHERE vault_key = ?');
    this.removeVault = this.db.prepare('DELETE FROM vaults WHERE key = ?');
  }

  /** Applies the writes of one request in a single transaction and returns everything newer than `sinceRev`. */
  sync(key: string, request: SyncRequest): SyncResult {
    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const vault = this.getVault.get(key) as VaultRow | undefined;
      let rev = vault?.rev ?? 0;
      let settingsJson = vault?.settings_json ?? null;
      let settingsUpdatedAt = vault?.settings_updated_at ?? null;

      const settingsAccepted =
        request.settings !== undefined &&
        (settingsUpdatedAt === null || Date.parse(request.settings.updatedAt) > Date.parse(settingsUpdatedAt));
      const hasWrites = request.upserts.length > 0 || request.deletes.length > 0 || settingsAccepted;

      if (hasWrites) {
        this.insertVault.run(key, now, now);
        rev += 1;
        for (const trip of request.upserts) this.upsertTrip.run(key, trip.id, rev, JSON.stringify(trip));
        for (const id of request.deletes) this.tombstoneTrip.run(key, id, rev);
        if (settingsAccepted && request.settings) {
          settingsJson = JSON.stringify(request.settings.data);
          settingsUpdatedAt = request.settings.updatedAt;
          this.saveSettings.run(settingsJson, settingsUpdatedAt, key);
        }
        this.touchVault.run(rev, now, key);
        if (request.upserts.length > 0) {
          const { n } = this.countTrips.get(key) as { n: number };
          if (n > this.maxTrips) throw new VaultLimitError(`vault is limited to ${this.maxTrips} trips`);
        }
      }

      const trips = (this.changedTrips.all(key, request.sinceRev) as { data_json: string }[]).map((row) => JSON.parse(row.data_json) as Trip);
      const deleted = (this.changedTombstones.all(key, request.sinceRev) as { id: string }[]).map((row) => row.id);
      this.db.exec('COMMIT');

      const result: SyncResult = { rev, trips, deleted };
      if (settingsJson !== null && settingsUpdatedAt !== null) {
        result.settings = { data: JSON.parse(settingsJson) as Record<string, unknown>, updatedAt: settingsUpdatedAt };
      }
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Removes the vault and all its trips. Returns false when there was nothing to remove. */
  deleteVault(key: string): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.removeTrips.run(key);
      const { changes } = this.removeVault.run(key);
      this.db.exec('COMMIT');
      return Number(changes) > 0;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
