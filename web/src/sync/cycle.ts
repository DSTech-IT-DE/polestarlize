/** One complete sync round: push local changes in batches, pull remote ones, apply everything. */
import type { StoredTrip } from '../domain/trip';
import { DEFAULT_SETTINGS, getSettings, LOCAL_ONLY_SETTINGS, updateSettings, type Settings } from '../lib/settings';
import { db, getMeta, setMeta, type Tombstone } from '../store/db';
import { stripStorage } from '../store/repository';
import { postSync, type SettingsPayload, type SyncRequestBody, type SyncResponseBody } from './api';

export const BATCH_SIZE = 5000;

export interface CycleContext {
  apiBase: string;
  userId: string;
  fetch?: typeof fetch;
  batchSize?: number;
  /** Returns false once the identity or server changed; the cycle then stops without touching the database. */
  isCurrent?: () => boolean;
}

export interface CycleResult {
  pushed: number;
  deleted: number;
  pulled: number;
}

export class CycleAbortedError extends Error {}

export const revKey = (apiBase: string, userId: string) => `sync.rev:${apiBase}:${userId}`;
export const settingsKey = (apiBase: string, userId: string) => `sync.settings:${apiBase}:${userId}`;

/** Splits pending changes into request-sized chunks. Always returns at least one (pull-only) batch. */
export function planBatches<U, D>(upserts: readonly U[], deletes: readonly D[], size: number): { upserts: U[]; deletes: D[] }[] {
  const count = Math.max(1, Math.ceil(upserts.length / size), Math.ceil(deletes.length / size));
  return Array.from({ length: count }, (_, i) => ({
    upserts: upserts.slice(i * size, (i + 1) * size),
    deletes: deletes.slice(i * size, (i + 1) * size),
  }));
}

export function syncedSettings(settings: Settings): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!LOCAL_ONLY_SETTINGS.includes(key as keyof Settings)) data[key] = value;
  }
  return data;
}

/** Keeps only known, synced keys whose type matches the defaults; a newer client may know more keys. */
export function acceptRemoteSettings(data: Record<string, unknown>): Partial<Settings> {
  const accepted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (LOCAL_ONLY_SETTINGS.includes(key as keyof Settings)) continue;
    const fallback = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
    if (fallback !== undefined && typeof value === typeof fallback) accepted[key] = value;
  }
  return accepted as Partial<Settings>;
}

interface ApplyInput {
  response: SyncResponseBody;
  /** Trips of this request with the `updatedAt` they had when they were read. */
  sent: { id: string; updatedAt: string }[];
  sentTombstones: Tombstone[];
  revKey: string;
  isCurrent: () => boolean;
}

/** Writes a server response into the local database in one transaction. Exported for tests. */
export async function applyResponse({ response, sent, sentTombstones, revKey: key, isCurrent }: ApplyInput): Promise<void> {
  await db.transaction('rw', db.trips, db.tombstones, db.meta, async () => {
    if (!isCurrent()) throw new CycleAbortedError();
    const now = new Date().toISOString();

    // Incoming trips win over clean local copies. A locally changed copy is kept and pushed next round.
    const incomingLocal = await db.trips.bulkGet(response.trips.map((t) => t.id));
    const sentById = new Map(sent.map((s) => [s.id, s.updatedAt]));
    const puts: StoredTrip[] = [];
    response.trips.forEach((trip, i) => {
      const local = incomingLocal[i];
      const isOurWrite = local?.dirty === 1 && sentById.get(trip.id) === local.updatedAt;
      if (!local || local.dirty === 0 || isOurWrite) puts.push({ ...trip, updatedAt: local?.updatedAt ?? now, dirty: 0 });
    });
    await db.trips.bulkPut(puts);

    // Deletions from other devices, unless the trip was re-imported here in the meantime.
    const goneLocal = await db.trips.bulkGet(response.deleted);
    const goneIds = response.deleted.filter((_, i) => goneLocal[i] && goneLocal[i]!.dirty === 0);
    await db.trips.bulkDelete(goneIds);

    // Sent trips are clean now unless they changed while the request was running.
    const sentLocal = await db.trips.bulkGet(sent.map((s) => s.id));
    const clean: StoredTrip[] = [];
    sent.forEach((s, i) => {
      const local = sentLocal[i];
      if (local && local.dirty === 1 && local.updatedAt === s.updatedAt) clean.push({ ...local, dirty: 0 });
    });
    await db.trips.bulkPut(clean);

    const tombstonesNow = await db.tombstones.bulkGet(sentTombstones.map((t) => t.id));
    const settled = sentTombstones.filter((t, i) => tombstonesNow[i]?.deletedAt === t.deletedAt).map((t) => t.id);
    await db.tombstones.bulkDelete(settled);

    await db.meta.put({ key, value: response.rev });
  });
}

function applyRemoteSettings(remote: SettingsPayload | undefined): void {
  if (!remote) return;
  const local = getSettings();
  if (Date.parse(remote.updatedAt) > Date.parse(local.updatedAt || '1970-01-01T00:00:00Z')) {
    updateSettings({ ...acceptRemoteSettings(remote.data), updatedAt: remote.updatedAt });
  }
}

export async function runSyncCycle(ctx: CycleContext): Promise<CycleResult> {
  const isCurrent = ctx.isCurrent ?? (() => true);
  const size = ctx.batchSize ?? BATCH_SIZE;
  const rKey = revKey(ctx.apiBase, ctx.userId);
  const sKey = settingsKey(ctx.apiBase, ctx.userId);

  let sinceRev = (await getMeta<number>(rKey)) ?? 0;
  const dirty = await db.trips.where('dirty').equals(1).toArray();
  const tombstones = await db.tombstones.toArray();
  const local = getSettings();
  const settingsSeen = await getMeta<string>(sKey);
  let pendingSettings: SettingsPayload | undefined =
    local.updatedAt && local.updatedAt !== settingsSeen ? { data: syncedSettings(local), updatedAt: local.updatedAt } : undefined;

  const result: CycleResult = { pushed: dirty.length, deleted: tombstones.length, pulled: 0 };
  for (const batch of planBatches(dirty, tombstones, size)) {
    if (!isCurrent()) throw new CycleAbortedError();
    const body: SyncRequestBody = {
      sinceRev,
      upserts: batch.upserts.map(stripStorage),
      deletes: batch.deletes.map((t) => t.id),
      ...(pendingSettings ? { settings: pendingSettings } : {}),
    };
    let response = await postSync(ctx.apiBase, ctx.userId, body, ctx.fetch);
    if (response.rev < sinceRev) {
      // The vault was deleted or reset on the server; start over from its current state.
      response = await postSync(ctx.apiBase, ctx.userId, { ...body, sinceRev: 0 }, ctx.fetch);
    }
    await applyResponse({
      response,
      sent: batch.upserts.map((t) => ({ id: t.id, updatedAt: t.updatedAt })),
      sentTombstones: batch.deletes,
      revKey: rKey,
      isCurrent,
    });
    sinceRev = response.rev;
    result.pulled += response.trips.length;
    if (response.settings) {
      applyRemoteSettings(response.settings);
      await setMeta(sKey, response.settings.updatedAt);
    }
    pendingSettings = undefined;
  }
  return result;
}

/** Forgets what was synced with this server for this ID, so the next round pulls everything. */
export async function resetSyncPosition(apiBase: string, userId: string): Promise<void> {
  await db.meta.bulkDelete([revKey(apiBase, userId), settingsKey(apiBase, userId)]);
}
