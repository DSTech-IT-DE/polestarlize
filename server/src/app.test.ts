import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type AppOptions } from './app.ts';
import { Store, vaultKey } from './store.ts';
import { LIMITS, type Trip } from './validation.ts';

const USER = '3f2b8c1e-7a4d-4e9b-8c55-1d2e3f4a5b6c';
const OTHER = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

function trip(n: number, overrides: Partial<Trip> = {}): Trip {
  const day = String((n % 28) + 1).padStart(2, '0');
  const start = `2025-03-${day}T08:${String(n % 60).padStart(2, '0')}`;
  return {
    id: `${start}|${10_000 + n}`,
    start,
    end: `2025-03-${day}T09:${String(n % 60).padStart(2, '0')}`,
    startAddress: 'Start street 1',
    endAddress: 'End street 2',
    distanceKm: 12.5,
    energyKwh: 2.1,
    category: 'Work',
    startLat: 52.5,
    startLon: 13.4,
    endLat: 52.6,
    endLon: 13.5,
    startOdometerKm: 10_000 + n,
    endOdometerKm: 10_012 + n,
    tripType: 'SINGLE',
    socStart: 80,
    socEnd: 75,
    comment: '',
    ...overrides,
  };
}

let dir: string;
let store: Store;
let app: ReturnType<typeof createApp>;

function setup(options: Partial<AppOptions> = {}) {
  app = createApp({ store, version: '1.2.3', ...options });
}

function call(method: string, path: string, init: { user?: string | null; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...init.headers };
  const user = init.user === undefined ? USER : init.user;
  if (user) headers.Authorization = `Bearer ${user}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  return app.request(`/api/v1${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
  });
}

const sync = (body: unknown, user?: string | null) => call('POST', '/sync', { body, user });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'polestarlize-test-'));
  store = new Store(join(dir, 'nested', 'test.sqlite'));
  setup();
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('health', () => {
  it('reports status, version and sync flag', async () => {
    const res = await call('GET', '/health', { user: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', version: '1.2.3', sync: true });
  });

  it('reports sync false and hides the sync endpoints when disabled', async () => {
    setup({ syncEnabled: false });
    expect(await (await call('GET', '/health')).json()).toMatchObject({ sync: false });
    expect((await sync({ sinceRev: 0, upserts: [], deletes: [] })).status).toBe(404);
    expect((await call('DELETE', '/vault')).status).toBe(404);
  });

  it('answers unknown API paths with a JSON 404', async () => {
    const res = await call('GET', '/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});

describe('authentication', () => {
  it.each([
    ['missing header', null],
    ['not a uuid', 'hello'],
    ['uuid with trailing junk', `${USER}x`],
  ])('rejects %s', async (_name, user) => {
    const res = await sync({ sinceRev: 0, upserts: [], deletes: [] }, user);
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: string }).toHaveProperty('error');
  });

  it('rejects a wrong scheme', async () => {
    const res = await call('POST', '/sync', { user: null, headers: { Authorization: `Basic ${USER}` }, body: { sinceRev: 0 } });
    expect(res.status).toBe(401);
  });

  it('protects DELETE /vault', async () => {
    expect((await call('DELETE', '/vault', { user: null })).status).toBe(401);
  });

  it('never stores the raw user id', async () => {
    await sync({ sinceRev: 0, upserts: [trip(1)], deletes: [] });
    expect(vaultKey(USER)).toMatch(/^[0-9a-f]{64}$/);
    expect(vaultKey(USER.toUpperCase())).toBe(vaultKey(USER));
    const raw = await readDatabaseText(join(dir, 'nested', 'test.sqlite'));
    expect(raw.includes(USER)).toBe(false);
  });
});

async function readDatabaseText(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  store.close();
  const text = (await readFile(path)).toString('latin1');
  store = new Store(path);
  setup();
  return text;
}

describe('sync round trip', () => {
  it('does not create a vault or bump the revision for a pure pull', async () => {
    const res = await sync({ sinceRev: 0, upserts: [], deletes: [] });
    expect(await res.json()).toEqual({ rev: 0, trips: [], deleted: [] });
  });

  it('bumps the revision once per request with writes', async () => {
    const first = (await (await sync({ sinceRev: 0, upserts: [trip(1), trip(2), trip(3)], deletes: [] })).json()) as { rev: number };
    expect(first.rev).toBe(1);
    const second = (await (await sync({ sinceRev: 1, upserts: [trip(4)], deletes: [] })).json()) as { rev: number };
    expect(second.rev).toBe(2);
    const idle = (await (await sync({ sinceRev: 2, upserts: [], deletes: [] })).json()) as { rev: number };
    expect(idle.rev).toBe(2);
  });

  it('moves trips between two devices and only returns what is newer', async () => {
    const a = (await (await sync({ sinceRev: 0, upserts: [trip(1), trip(2)], deletes: [] })).json()) as { rev: number };
    const bPull = (await (await sync({ sinceRev: 0, upserts: [], deletes: [] })).json()) as { rev: number; trips: Trip[] };
    expect(bPull.trips.map((t) => t.id).sort()).toEqual([trip(1).id, trip(2).id].sort());
    expect(bPull.rev).toBe(a.rev);

    await sync({ sinceRev: bPull.rev, upserts: [trip(3)], deletes: [] });
    const aPull = (await (await sync({ sinceRev: a.rev, upserts: [], deletes: [] })).json()) as { trips: Trip[] };
    expect(aPull.trips).toEqual([trip(3)]);
  });

  it('returns the stored trip unchanged', async () => {
    const t = trip(5, { comment: 'Ünïcode ✓', energyKwh: null, socStart: null });
    await sync({ sinceRev: 0, upserts: [t], deletes: [] });
    const pull = (await (await sync({ sinceRev: 0, upserts: [], deletes: [] })).json()) as { trips: Trip[] };
    expect(pull.trips).toEqual([t]);
  });

  it('overwrites a trip with the same id', async () => {
    await sync({ sinceRev: 0, upserts: [trip(1)], deletes: [] });
    await sync({ sinceRev: 1, upserts: [trip(1, { comment: 'edited' })], deletes: [] });
    const pull = (await (await sync({ sinceRev: 0, upserts: [], deletes: [] })).json()) as { trips: Trip[] };
    expect(pull.trips).toHaveLength(1);
    expect(pull.trips[0].comment).toBe('edited');
  });

  it('isolates vaults by user id', async () => {
    await sync({ sinceRev: 0, upserts: [trip(1)], deletes: [] });
    const other = (await (await sync({ sinceRev: 0, upserts: [], deletes: [] }, OTHER)).json()) as { trips: Trip[] };
    expect(other.trips).toEqual([]);
  });

  it('treats the user id case-insensitively', async () => {
    await sync({ sinceRev: 0, upserts: [trip(1)], deletes: [] }, USER.toUpperCase());
    const pull = (await (await sync({ sinceRev: 0, upserts: [], deletes: [] }, USER)).json()) as { trips: Trip[] };
    expect(pull.trips).toHaveLength(1);
  });
});

describe('tombstones', () => {
  it('propagates deletions and keeps them out of the trip list', async () => {
    await sync({ sinceRev: 0, upserts: [trip(1), trip(2)], deletes: [] });
    const del = (await (await sync({ sinceRev: 1, upserts: [], deletes: [trip(1).id] })).json()) as { rev: number; deleted: string[] };
    expect(del.rev).toBe(2);
    expect(del.deleted).toEqual([trip(1).id]);

    const fresh = (await (await sync({ sinceRev: 0, upserts: [], deletes: [] })).json()) as { trips: Trip[]; deleted: string[] };
    expect(fresh.trips.map((t) => t.id)).toEqual([trip(2).id]);
    expect(fresh.deleted).toEqual([trip(1).id]);

    const caughtUp = (await (await sync({ sinceRev: 2, upserts: [], deletes: [] })).json()) as { trips: Trip[]; deleted: string[] };
    expect(caughtUp.deleted).toEqual([]);
  });

  it('lets a later upsert resurrect a deleted trip', async () => {
    await sync({ sinceRev: 0, upserts: [trip(1)], deletes: [] });
    await sync({ sinceRev: 1, upserts: [], deletes: [trip(1).id] });
    await sync({ sinceRev: 2, upserts: [trip(1)], deletes: [] });
    const pull = (await (await sync({ sinceRev: 0, upserts: [], deletes: [] })).json()) as { trips: Trip[]; deleted: string[] };
    expect(pull.trips).toHaveLength(1);
    expect(pull.deleted).toEqual([]);
  });

  it('records tombstones for unknown ids so offline devices learn about them', async () => {
    const res = (await (await sync({ sinceRev: 0, upserts: [], deletes: ['2020-01-01T00:00|1'] })).json()) as { deleted: string[] };
    expect(res.deleted).toEqual(['2020-01-01T00:00|1']);
  });
});

describe('settings', () => {
  const settings = (updatedAt: string, homePrice: number) => ({ data: { homePrice }, updatedAt });

  it('stores settings and lets the newest write win', async () => {
    await sync({ sinceRev: 0, upserts: [], deletes: [], settings: settings('2025-01-02T00:00:00.000Z', 0.3) });
    const older = (await (await sync({ sinceRev: 1, upserts: [], deletes: [], settings: settings('2025-01-01T00:00:00.000Z', 0.1) })).json()) as {
      rev: number;
      settings: { data: { homePrice: number } };
    };
    expect(older.rev).toBe(1);
    expect(older.settings.data.homePrice).toBe(0.3);

    const newer = (await (await sync({ sinceRev: 1, upserts: [], deletes: [], settings: settings('2025-01-03T00:00:00.000Z', 0.5) })).json()) as {
      rev: number;
      settings: { data: { homePrice: number }; updatedAt: string };
    };
    expect(newer.rev).toBe(2);
    expect(newer.settings).toEqual({ data: { homePrice: 0.5 }, updatedAt: '2025-01-03T00:00:00.000Z' });
  });

  it('returns stored settings to a device that sends none', async () => {
    await sync({ sinceRev: 0, upserts: [], deletes: [], settings: settings('2025-01-02T00:00:00.000Z', 0.3) });
    const pull = (await (await sync({ sinceRev: 0, upserts: [], deletes: [] })).json()) as { settings?: { data: unknown } };
    expect(pull.settings?.data).toEqual({ homePrice: 0.3 });
  });

  it('rejects oversized or malformed settings', async () => {
    const big = { data: { blob: 'x'.repeat(17 * 1024) }, updatedAt: '2025-01-01T00:00:00.000Z' };
    expect((await sync({ sinceRev: 0, upserts: [], deletes: [], settings: big })).status).toBe(400);
    expect((await sync({ sinceRev: 0, upserts: [], deletes: [], settings: { data: {}, updatedAt: 'yesterday' } })).status).toBe(400);
    expect((await sync({ sinceRev: 0, upserts: [], deletes: [], settings: { data: [], updatedAt: '2025-01-01T00:00:00Z' } })).status).toBe(400);
  });
});

describe('vault deletion', () => {
  it('removes the vault and everything in it', async () => {
    await sync({ sinceRev: 0, upserts: [trip(1)], deletes: [trip(2).id], settings: { data: {}, updatedAt: '2025-01-01T00:00:00Z' } });
    const res = await call('DELETE', '/vault');
    expect(await res.json()).toEqual({ deleted: true });
    const pull = await (await sync({ sinceRev: 0, upserts: [], deletes: [] })).json();
    expect(pull).toEqual({ rev: 0, trips: [], deleted: [] });
    expect(await (await call('DELETE', '/vault')).json()).toEqual({ deleted: false });
  });

  it('leaves other vaults alone', async () => {
    await sync({ sinceRev: 0, upserts: [trip(1)], deletes: [] }, OTHER);
    await call('DELETE', '/vault');
    const pull = (await (await sync({ sinceRev: 0, upserts: [], deletes: [] }, OTHER)).json()) as { trips: Trip[] };
    expect(pull.trips).toHaveLength(1);
  });
});

describe('validation', () => {
  async function expect400(body: unknown, match?: RegExp) {
    const res = await sync(body);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    if (match) expect(json.error).toMatch(match);
  }

  it('rejects invalid JSON', async () => {
    const res = await call('POST', '/sync', { body: '{nope', headers: {} });
    expect(res.status).toBe(400);
  });

  it('rejects a bad sinceRev', async () => {
    await expect400({ sinceRev: -1, upserts: [], deletes: [] }, /sinceRev/);
    await expect400({ sinceRev: 1.5, upserts: [], deletes: [] }, /sinceRev/);
    await expect400({ upserts: [], deletes: [] }, /sinceRev/);
  });

  it('rejects non-array upserts and deletes', async () => {
    await expect400({ sinceRev: 0, upserts: {}, deletes: [] }, /upserts/);
    await expect400({ sinceRev: 0, upserts: [], deletes: 'x' }, /deletes/);
    await expect400({ sinceRev: 0, upserts: [], deletes: [1] }, /deletes\[0\]/);
  });

  it('rejects malformed trips and names the offending field', async () => {
    await expect400({ sinceRev: 0, upserts: [{ ...trip(1), distanceKm: 'far' }], deletes: [] }, /upserts\[0\]\.distanceKm/);
    const overflow = `{"sinceRev":0,"upserts":[${JSON.stringify(trip(1)).replace('"energyKwh":2.1', '"energyKwh":1e999')}],"deletes":[]}`;
    await expect400(overflow, /energyKwh/);
    await expect400({ sinceRev: 0, upserts: [{ ...trip(1), startLat: 123 }], deletes: [] }, /startLat/);
    await expect400({ sinceRev: 0, upserts: [{ ...trip(1), start: 'tomorrow' }], deletes: [] }, /start/);
    await expect400({ sinceRev: 0, upserts: [{ ...trip(1), comment: 'x'.repeat(2001) }], deletes: [] }, /comment/);
    await expect400({ sinceRev: 0, upserts: [{ ...trip(1), id: 'x'.repeat(200) }], deletes: [] }, /id/);
    await expect400({ sinceRev: 0, upserts: ['trip'], deletes: [] }, /expected an object/);
    const { comment: _c, ...incomplete } = trip(1);
    await expect400({ sinceRev: 0, upserts: [incomplete], deletes: [] }, /comment/);
  });

  it('drops unknown trip fields instead of storing them', async () => {
    await sync({ sinceRev: 0, upserts: [{ ...trip(1), injected: '<script>' }], deletes: [] });
    const pull = (await (await sync({ sinceRev: 0, upserts: [], deletes: [] })).json()) as { trips: Trip[] };
    expect(pull.trips[0]).toEqual(trip(1));
  });

  it('rejects duplicate ids and ids that are upserted and deleted together', async () => {
    await expect400({ sinceRev: 0, upserts: [trip(1), trip(1)], deletes: [] }, /duplicate/);
    await expect400({ sinceRev: 0, upserts: [trip(1)], deletes: [trip(1).id] }, /both/);
  });

  it('does not write anything when a request is rejected', async () => {
    await sync({ sinceRev: 0, upserts: [trip(1), { ...trip(2), distanceKm: -1 }], deletes: [] });
    const pull = await (await sync({ sinceRev: 0, upserts: [], deletes: [] })).json();
    expect(pull).toEqual({ rev: 0, trips: [], deleted: [] });
  });
});

describe('limits', () => {
  it('rejects more than 20 000 upserts per request', async () => {
    const upserts = Array.from({ length: 20_001 }, (_, i) => trip(i));
    const res = await sync({ sinceRev: 0, upserts, deletes: [] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/smaller batches/);
  });

  it('accepts exactly 20 000 upserts', async () => {
    const upserts = Array.from({ length: 20_000 }, (_, i) => trip(i, { id: `t${i}` }));
    const res = await sync({ sinceRev: 0, upserts, deletes: [] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { trips: Trip[] }).trips).toHaveLength(20_000);
  });

  it('rejects request bodies above 25 MB', async () => {
    const res = await call('POST', '/sync', {
      body: JSON.stringify({ sinceRev: 0, upserts: [], deletes: [], pad: 'x'.repeat(26 * 1024 * 1024) }),
    });
    expect(res.status).toBe(413);
  });

  it('caps the number of trips per vault and rolls the request back', async () => {
    expect(LIMITS.maxTripsPerVault).toBe(250_000);
    store.close();
    store = new Store(join(dir, 'small.sqlite'), { maxTripsPerVault: 10 });
    setup();
    const make = (from: number, count: number) => Array.from({ length: count }, (_, i) => trip(from + i, { id: `t${from + i}` }));
    expect((await sync({ sinceRev: 0, upserts: make(0, 8), deletes: [] })).status).toBe(200);
    const over = await sync({ sinceRev: 0, upserts: make(8, 3), deletes: [] });
    expect(over.status).toBe(413);
    const pull = (await (await sync({ sinceRev: 0, upserts: [], deletes: [] })).json()) as { rev: number; trips: Trip[] };
    expect(pull.trips).toHaveLength(8);
    expect(pull.rev).toBe(1);
  });
});

describe('rate limiting', () => {
  it('answers 429 with Retry-After once the bucket is empty', async () => {
    setup({ rateLimitPerMinute: 3 });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await call('GET', '/health')).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    const limited = await call('GET', '/health');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('keys clients by X-Forwarded-For only when the proxy is trusted', async () => {
    setup({ rateLimitPerMinute: 1, trustProxy: true });
    const health = (ip: string) => app.request('/api/v1/health', { headers: { 'X-Forwarded-For': `6.6.6.6, ${ip}` } });
    expect((await health('1.1.1.1')).status).toBe(200);
    expect((await health('1.1.1.1')).status).toBe(429);
    expect((await health('2.2.2.2')).status).toBe(200);

    setup({ rateLimitPerMinute: 1, trustProxy: false });
    expect((await health('1.1.1.1')).status).toBe(200);
    expect((await health('2.2.2.2')).status).toBe(429);
  });
});

describe('CORS', () => {
  const origin = 'https://example.github.io';

  it('is disabled by default', async () => {
    const res = await app.request('/api/v1/health', { headers: { Origin: origin } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('allows only the configured origins', async () => {
    setup({ corsOrigins: [origin] });
    const allowed = await app.request('/api/v1/health', { headers: { Origin: origin } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(origin);
    const denied = await app.request('/api/v1/health', { headers: { Origin: 'https://evil.example' } });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers preflight requests for the authorization header', async () => {
    setup({ corsOrigins: [origin] });
    const res = await app.request('/api/v1/sync', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });
});

describe('static files and headers', () => {
  let staticDir: string;

  beforeEach(() => {
    staticDir = join(dir, 'web');
    mkdirSync(join(staticDir, 'assets'), { recursive: true });
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>app</title>');
    writeFileSync(join(staticDir, 'assets', 'app-abc123.js'), 'console.log(1)');
    writeFileSync(join(dir, 'secret.txt'), 'secret');
    setup({ staticDir });
  });

  it('serves index.html without caching', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<title>app</title>');
  });

  it('serves hashed assets with long cache headers', async () => {
    const res = await app.request('/assets/app-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('content-type')).toContain('javascript');
  });

  it('falls back to index.html for SPA routes but 404s missing files', async () => {
    expect(await (await app.request('/trips/2025')).text()).toContain('<title>app</title>');
    expect((await app.request('/assets/missing.js')).status).toBe(404);
  });

  it('does not leak files outside the static directory', async () => {
    const res = await app.request('/..%2Fsecret.txt');
    expect(await res.text()).not.toContain('secret');
  });

  it('never serves the SPA for API paths', async () => {
    const res = await app.request('/api/v2/whatever');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('json');
  });

  it('sets security headers on every response', async () => {
    for (const path of ['/', '/api/v1/health', '/assets/app-abc123.js']) {
      const res = await app.request(path);
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain('https://tiles.openfreemap.org');
      expect(csp).toContain('worker-src');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });
});
