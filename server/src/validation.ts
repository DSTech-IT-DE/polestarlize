/** Strict validation of the sync payloads. Mirrors the `Trip` interface of the web app. */

export interface Trip {
  id: string;
  start: string;
  end: string;
  startAddress: string;
  endAddress: string;
  distanceKm: number;
  energyKwh: number | null;
  category: string;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  tripType: string;
  socStart: number | null;
  socEnd: number | null;
  comment: string;
  /** The user's decision whether the trip counts in the analyses. */
  review?: 'include' | 'exclude';
}

export interface SettingsPayload {
  data: Record<string, unknown>;
  updatedAt: string;
}

export interface SyncRequest {
  sinceRev: number;
  upserts: Trip[];
  deletes: string[];
  settings?: SettingsPayload;
}

export const LIMITS = {
  maxBodyBytes: 25 * 1024 * 1024,
  maxTripsPerVault: 250_000,
  maxUpsertsPerRequest: 20_000,
  maxDeletesPerRequest: 20_000,
  maxSettingsBytes: 16 * 1024,
} as const;

const MAX_ID = 128;
const MAX_ADDRESS = 500;
const MAX_SHORT = 100;
const MAX_COMMENT = 2000;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export class ValidationError extends Error {}

function fail(path: string, message: string): never {
  throw new ValidationError(`${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, path: string, max: number): string {
  if (typeof value !== 'string') fail(path, 'expected a string');
  if (value.length > max) fail(path, `longer than ${max} characters`);
  return value;
}

function localTime(value: unknown, path: string): string {
  const s = text(value, path, 19);
  if (!LOCAL_TIME.test(s)) fail(path, 'expected YYYY-MM-DDTHH:mm');
  return s;
}

function num(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'expected a finite number');
  if (value < min || value > max) fail(path, `out of range ${min}..${max}`);
  return value;
}

function nullableNum(value: unknown, path: string, min: number, max: number): number | null {
  return value === null ? null : num(value, path, min, max);
}

function review(value: unknown, path: string): Trip['review'] {
  if (value === undefined || value === null) return undefined;
  if (value !== 'include' && value !== 'exclude') fail(path, "expected 'include' or 'exclude'");
  return value;
}

export function parseTrip(value: unknown, path: string): Trip {
  if (!isRecord(value)) fail(path, 'expected an object');
  const v = value;
  const decision = review(v.review, `${path}.review`);
  return {
    id: text(v.id, `${path}.id`, MAX_ID),
    start: localTime(v.start, `${path}.start`),
    end: localTime(v.end, `${path}.end`),
    startAddress: text(v.startAddress, `${path}.startAddress`, MAX_ADDRESS),
    endAddress: text(v.endAddress, `${path}.endAddress`, MAX_ADDRESS),
    distanceKm: num(v.distanceKm, `${path}.distanceKm`, 0, 1_000_000),
    energyKwh: nullableNum(v.energyKwh, `${path}.energyKwh`, -100_000, 100_000),
    category: text(v.category, `${path}.category`, MAX_SHORT),
    startLat: nullableNum(v.startLat, `${path}.startLat`, -90, 90),
    startLon: nullableNum(v.startLon, `${path}.startLon`, -180, 180),
    endLat: nullableNum(v.endLat, `${path}.endLat`, -90, 90),
    endLon: nullableNum(v.endLon, `${path}.endLon`, -180, 180),
    startOdometerKm: nullableNum(v.startOdometerKm, `${path}.startOdometerKm`, 0, 100_000_000),
    endOdometerKm: nullableNum(v.endOdometerKm, `${path}.endOdometerKm`, 0, 100_000_000),
    tripType: text(v.tripType, `${path}.tripType`, MAX_SHORT),
    socStart: nullableNum(v.socStart, `${path}.socStart`, -1000, 1000),
    socEnd: nullableNum(v.socEnd, `${path}.socEnd`, -1000, 1000),
    comment: text(v.comment, `${path}.comment`, MAX_COMMENT),
    ...(decision ? { review: decision } : {}),
  };
}

function parseSettings(value: unknown): SettingsPayload {
  if (!isRecord(value)) fail('settings', 'expected an object');
  if (!isRecord(value.data)) fail('settings.data', 'expected an object');
  const updatedAt = text(value.updatedAt, 'settings.updatedAt', 40);
  if (Number.isNaN(Date.parse(updatedAt))) fail('settings.updatedAt', 'expected an ISO timestamp');
  if (Buffer.byteLength(JSON.stringify(value.data)) > LIMITS.maxSettingsBytes) {
    fail('settings.data', `larger than ${LIMITS.maxSettingsBytes} bytes`);
  }
  return { data: value.data, updatedAt };
}

export function parseSyncRequest(body: unknown): SyncRequest {
  if (!isRecord(body)) fail('body', 'expected a JSON object');
  const sinceRev = body.sinceRev;
  if (typeof sinceRev !== 'number' || !Number.isSafeInteger(sinceRev) || sinceRev < 0) {
    fail('sinceRev', 'expected a non-negative integer');
  }
  const rawUpserts = body.upserts ?? [];
  const rawDeletes = body.deletes ?? [];
  if (!Array.isArray(rawUpserts)) fail('upserts', 'expected an array');
  if (!Array.isArray(rawDeletes)) fail('deletes', 'expected an array');
  if (rawUpserts.length > LIMITS.maxUpsertsPerRequest) {
    fail('upserts', `more than ${LIMITS.maxUpsertsPerRequest} trips per request, send smaller batches`);
  }
  if (rawDeletes.length > LIMITS.maxDeletesPerRequest) {
    fail('deletes', `more than ${LIMITS.maxDeletesPerRequest} ids per request, send smaller batches`);
  }

  const upserts = rawUpserts.map((trip, i) => parseTrip(trip, `upserts[${i}]`));
  const upsertIds = new Set<string>();
  for (const trip of upserts) {
    if (upsertIds.has(trip.id)) fail('upserts', `duplicate id ${trip.id}`);
    upsertIds.add(trip.id);
  }
  const deletes = rawDeletes.map((id, i) => text(id, `deletes[${i}]`, MAX_ID));
  const deleteIds = new Set<string>();
  for (const id of deletes) {
    if (upsertIds.has(id)) fail('deletes', `id ${id} is both upserted and deleted`);
    deleteIds.add(id);
  }

  const request: SyncRequest = { sinceRev, upserts, deletes: [...deleteIds] };
  if (body.settings !== undefined && body.settings !== null) request.settings = parseSettings(body.settings);
  return request;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
