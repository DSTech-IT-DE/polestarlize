import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Trip } from '../domain/trip';
import { generateDemoTrips } from '../lib/demoData';
import { getSettings, updateSettings } from '../lib/settings';
import { db, getMeta } from '../store/db';
import { createBackup, deleteAllTrips, importTrips, restoreBackup } from '../store/repository';
import { resolveApiBase, type SettingsPayload, type SyncRequestBody, type SyncResponseBody } from './api';
import { acceptRemoteSettings, syncedSettings } from '../lib/settings';
import { CycleAbortedError, planBatches, revKey, runSyncCycle } from './cycle';

const BASE = 'http://sync.test/api/v1/';
const USER = '3f2b8c1e-7a4d-4e9b-8c55-1d2e3f4a5b6c';

/** Minimal in-memory implementation of the server protocol. */
function fakeServer() {
  const trips = new Map<string, { trip: Trip; rev: number; deleted: boolean }>();
  let rev = 0;
  let settings: SettingsPayload | undefined;
  const requests: SyncRequestBody[] = [];
  let beforeRespond: (() => Promise<void>) | null = null;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'DELETE' && url.endsWith('/vault')) {
      trips.clear();
      rev = 0;
      settings = undefined;
      return Response.json({ deleted: true });
    }
    const body = JSON.parse(String(init?.body)) as SyncRequestBody;
    requests.push(body);
    const writes = body.upserts.length > 0 || body.deletes.length > 0 || (body.settings && (!settings || body.settings.updatedAt > settings.updatedAt));
    if (writes) {
      rev += 1;
      for (const trip of body.upserts) trips.set(trip.id, { trip, rev, deleted: false });
      for (const id of body.deletes) trips.set(id, { trip: trips.get(id)?.trip as Trip, rev, deleted: true });
      if (body.settings && (!settings || body.settings.updatedAt > settings.updatedAt)) settings = body.settings;
    }
    const all = [...trips.entries()].filter(([, v]) => v.rev > body.sinceRev);
    const response: SyncResponseBody = {
      rev,
      trips: all.filter(([, v]) => !v.deleted).map(([, v]) => v.trip),
      deleted: all.filter(([, v]) => v.deleted).map(([id]) => id),
      ...(settings ? { settings } : {}),
    };
    if (beforeRespond) {
      const hook = beforeRespond;
      beforeRespond = null;
      await hook();
    }
    return Response.json(response);
  }) as typeof fetch;

  return {
    fetch: fetchImpl,
    requests,
    trips,
    get rev() {
      return rev;
    },
    onNextResponse(hook: () => Promise<void>) {
      beforeRespond = hook;
    },
  };
}

const demo = () => generateDemoTrips({ days: 12, seed: 7 });
const run = (server: ReturnType<typeof fakeServer>, extra: Partial<Parameters<typeof runSyncCycle>[0]> = {}) =>
  runSyncCycle({ apiBase: BASE, userId: USER, fetch: server.fetch, ...extra });

beforeEach(async () => {
  await db.trips.clear();
  await db.tombstones.clear();
  await db.meta.clear();
  await db.imports.clear();
  updateSettings({ updatedAt: '' });
});

describe('runSyncCycle', () => {
  it('pushes dirty trips and marks them clean', async () => {
    const server = fakeServer();
    const trips = demo();
    await importTrips([{ fileName: 'x', trips, skipped: 0 }]);
    expect(await db.trips.where('dirty').equals(1).count()).toBe(trips.length);

    const result = await run(server);
    expect(result.pushed).toBe(trips.length);
    expect(server.trips.size).toBe(trips.length);
    expect(await db.trips.where('dirty').equals(1).count()).toBe(0);
    expect(await db.trips.count()).toBe(trips.length);
    expect(await getMeta<number>(revKey(BASE, USER))).toBe(1);
  });

  it('sends nothing but still pulls when there are no local changes', async () => {
    const server = fakeServer();
    await importTrips([{ fileName: 'x', trips: demo(), skipped: 0 }]);
    await run(server);
    const rev = server.rev;
    await run(server);
    expect(server.rev).toBe(rev);
    expect(server.requests.at(-1)).toMatchObject({ sinceRev: rev, upserts: [], deletes: [] });
  });

  it('restores trips on a second device and ignores what it already has', async () => {
    const server = fakeServer();
    const trips = demo();
    await importTrips([{ fileName: 'x', trips, skipped: 0 }]);
    await run(server);

    await db.trips.clear();
    await db.meta.clear();
    const result = await run(server);
    expect(result.pulled).toBe(trips.length);
    const local = await db.trips.toArray();
    expect(local).toHaveLength(trips.length);
    expect(local.every((t) => t.dirty === 0)).toBe(true);
    expect(local.map((t) => t.id).sort()).toEqual(trips.map((t) => t.id).sort());
  });

  it('propagates deletions both ways and clears sent tombstones', async () => {
    const server = fakeServer();
    const trips = demo();
    await importTrips([{ fileName: 'x', trips, skipped: 0 }]);
    await run(server);

    await deleteAllTrips({ propagate: true });
    expect(await db.tombstones.count()).toBe(trips.length);
    await run(server);
    expect(await db.tombstones.count()).toBe(0);
    expect([...server.trips.values()].every((v) => v.deleted)).toBe(true);
  });

  it('applies deletions made on another device', async () => {
    const server = fakeServer();
    const trips = demo();
    await importTrips([{ fileName: 'x', trips, skipped: 0 }]);
    await run(server);
    const victim = trips[0].id;
    const entry = server.trips.get(victim)!;
    entry.deleted = true;
    entry.rev = 99;
    await run(server);
    expect(await db.trips.get(victim)).toBeUndefined();
    expect(await db.trips.count()).toBe(trips.length - 1);
  });

  it('splits large pushes into batches and keeps advancing sinceRev', async () => {
    const server = fakeServer();
    const trips = demo().slice(0, 25);
    await importTrips([{ fileName: 'x', trips, skipped: 0 }]);
    await run(server, { batchSize: 10 });
    expect(server.requests.map((r) => r.upserts.length)).toEqual([10, 10, 5]);
    expect(server.requests.map((r) => r.sinceRev)).toEqual([0, 1, 2]);
    expect(server.trips.size).toBe(25);
    expect(await db.trips.where('dirty').equals(1).count()).toBe(0);
  });

  it('keeps a trip dirty when it changed while the request was running', async () => {
    const server = fakeServer();
    const trips = demo().slice(0, 3);
    await importTrips([{ fileName: 'x', trips, skipped: 0 }]);
    server.onNextResponse(async () => {
      const first = (await db.trips.toArray())[0];
      await db.trips.put({ ...first, comment: 'edited meanwhile', updatedAt: new Date(Date.now() + 5000).toISOString(), dirty: 1 });
    });
    await run(server);
    const dirty = await db.trips.where('dirty').equals(1).toArray();
    expect(dirty).toHaveLength(1);
    expect(dirty[0].comment).toBe('edited meanwhile');
    // The echoed server copy must not overwrite the newer local edit.
    await run(server);
    expect(server.trips.get(dirty[0].id)!.trip.comment).toBe('edited meanwhile');
    expect(await db.trips.where('dirty').equals(1).count()).toBe(0);
  });

  it('starts over when the server lost its vault', async () => {
    const server = fakeServer();
    await importTrips([{ fileName: 'x', trips: demo(), skipped: 0 }]);
    await run(server);
    await server.fetch(`${BASE}vault`, { method: 'DELETE' });
    // Another device writes to the fresh vault.
    await server.fetch(`${BASE}sync`, { method: 'POST', body: JSON.stringify({ sinceRev: 0, upserts: [demo()[0]], deletes: [] }) });
    await expect(run(server)).resolves.toBeDefined();
    expect(await getMeta<number>(revKey(BASE, USER))).toBe(server.rev);
  });

  it('syncs vehicle and price settings with last-write-wins but not local-only ones', async () => {
    const server = fakeServer();
    updateSettings({ homePrice: 0.41, theme: 'dark', syncServerUrl: 'https://mine.example', mapConsent: true });
    await run(server);
    const sent = server.requests[0].settings!;
    expect(sent.data.homePrice).toBe(0.41);
    expect(sent.data).not.toHaveProperty('theme');
    expect(sent.data).not.toHaveProperty('syncServerUrl');
    expect(sent.data).not.toHaveProperty('mapConsent');
    expect(sent.data).not.toHaveProperty('updatedAt');

    // A newer value from another device replaces the local one.
    const newer = new Date(Date.now() + 60_000).toISOString();
    await server.fetch(`${BASE}sync`, {
      method: 'POST',
      body: JSON.stringify({ sinceRev: 0, upserts: [], deletes: [], settings: { data: { homePrice: 0.77 }, updatedAt: newer } }),
    });
    await run(server);
    expect(getSettings().homePrice).toBe(0.77);
    expect(getSettings().updatedAt).toBe(newer);
    expect(getSettings().theme).toBe('dark');

    // Unchanged settings are not sent again.
    await run(server);
    expect(server.requests.at(-1)!.settings).toBeUndefined();
  });

  it('stops without writing when the identity changed mid-flight', async () => {
    const server = fakeServer();
    await importTrips([{ fileName: 'x', trips: demo().slice(0, 4), skipped: 0 }]);
    let current = true;
    server.onNextResponse(async () => {
      current = false;
    });
    await expect(run(server, { isCurrent: () => current })).rejects.toBeInstanceOf(CycleAbortedError);
    expect(await db.trips.where('dirty').equals(1).count()).toBe(4);
    expect(await getMeta(revKey(BASE, USER))).toBeUndefined();
  });
});

describe('helpers', () => {
  it('planBatches always yields at least one batch and respects the size', () => {
    expect(planBatches([], [], 5)).toEqual([{ upserts: [], deletes: [] }]);
    expect(planBatches([1, 2, 3], ['a'], 2)).toEqual([
      { upserts: [1, 2], deletes: ['a'] },
      { upserts: [3], deletes: [] },
    ]);
    expect(planBatches([1], ['a', 'b', 'c'], 2)).toHaveLength(2);
  });

  it('syncedSettings leaves out device-local settings', () => {
    const data = syncedSettings({ ...getSettings(), theme: 'dark', syncServerUrl: 'x', mapConsent: true, updatedAt: 'now' });
    expect(Object.keys(data)).toEqual(expect.arrayContaining(['vehicle', 'usableCapacityKwh', 'homePrice', 'distanceUnit', 'currency']));
    for (const key of ['theme', 'syncServerUrl', 'mapConsent', 'updatedAt']) expect(data).not.toHaveProperty(key);
  });

  it('backups carry the review decisions, the charging places and the synced settings', async () => {
    const trips = generateDemoTrips().slice(0, 5);
    await importTrips([{ fileName: 'a.csv', trips, skipped: 0 }]);
    await db.trips.update(trips[0].id, { review: 'exclude' });
    const place = { id: 'p1', lat: 57.7, lon: 11.97, kind: 'work' as const, price: 0.1, label: 'Work 1' };
    updateSettings({ places: [place], homePrice: 0.27 });
    const backup = JSON.parse(JSON.stringify(await createBackup('user'))) as Awaited<ReturnType<typeof createBackup>>;
    expect(backup.settings).not.toHaveProperty('syncServerUrl');

    await deleteAllTrips({ propagate: false });
    updateSettings({ places: [], homePrice: 0.4 });
    await restoreBackup(backup);
    expect(getSettings()).toMatchObject({ places: [place], homePrice: 0.27 });
    expect((await db.trips.get(trips[0].id))?.review).toBe('exclude');
    expect(await db.trips.count()).toBe(5);
  });

  it('acceptRemoteSettings drops unknown keys, wrong types and local-only keys', () => {
    expect(acceptRemoteSettings({ homePrice: 0.5, homeShare: 'lots', somethingNew: 1, theme: 'dark', syncServerUrl: 'https://evil.example' })).toEqual({ homePrice: 0.5 });
  });

  it('resolveApiBase handles same-origin, server roots and full API URLs', () => {
    expect(resolveApiBase('', 'https://owner.github.io/polestarlize/#/settings')).toBe('https://owner.github.io/polestarlize/api/v1/');
    expect(resolveApiBase('', 'http://localhost:8080/')).toBe('http://localhost:8080/api/v1/');
    expect(resolveApiBase(' https://sync.example.org ')).toBe('https://sync.example.org/api/v1/');
    expect(resolveApiBase('https://example.org/sync/')).toBe('https://example.org/sync/api/v1/');
    expect(resolveApiBase('https://example.org/api/v1')).toBe('https://example.org/api/v1/');
    expect(() => resolveApiBase('ftp://example.org')).toThrow();
    expect(() => resolveApiBase('not a url')).toThrow();
  });
});
