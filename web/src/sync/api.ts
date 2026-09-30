/** HTTP layer of the sync: URL resolution, server detection and the three API calls. */
import type { Trip } from '../domain/trip';

export interface SettingsPayload {
  data: Record<string, unknown>;
  updatedAt: string;
}

export interface SyncRequestBody {
  sinceRev: number;
  upserts: Trip[];
  deletes: string[];
  settings?: SettingsPayload;
}

export interface SyncResponseBody {
  rev: number;
  trips: Trip[];
  deleted: string[];
  settings?: SettingsPayload;
}

export interface Health {
  version: string;
  sync: boolean;
}

export class SyncHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Fetch = typeof fetch;

/** Turns what the user typed (or nothing) into the API base URL. Throws on invalid input. */
export function resolveApiBase(syncServerUrl: string, documentBase?: string): string {
  const typed = syncServerUrl.trim();
  if (!typed) return new URL('api/v1/', documentBase ?? document.baseURI).href;
  const url = new URL(typed);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https URLs are supported');
  url.search = '';
  url.hash = '';
  // Accept both the server root and the full API URL.
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  url.pathname = `${path}/api/v1/`;
  return url.href;
}

const isJson = (response: Response) => (response.headers.get('content-type') ?? '').includes('json');

/** Asks `<base>health`. Resolves with the health document or throws. */
export async function fetchHealth(apiBase: string, fetchImpl: Fetch = fetch): Promise<Health> {
  const response = await fetchImpl(`${apiBase}health`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new SyncHttpError(response.status, `Health check answered ${response.status}`);
  // Static hosts answer unknown paths with an HTML page; that is not a sync server.
  if (!isJson(response)) throw new SyncHttpError(response.status, 'Health check did not answer with JSON');
  const body = (await response.json()) as { status?: string; version?: string; sync?: boolean };
  if (body.status !== 'ok') throw new SyncHttpError(response.status, 'Unexpected health response');
  return { version: String(body.version ?? ''), sync: body.sync === true };
}

async function failure(response: Response): Promise<SyncHttpError> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: string };
    detail = body.error ?? '';
  } catch {
    // The body is not JSON; the status code has to do.
  }
  return new SyncHttpError(response.status, detail ? `${response.status}: ${detail}` : `Server answered ${response.status}`);
}

function headers(userId: string, json: boolean): Record<string, string> {
  return { Authorization: `Bearer ${userId}`, ...(json ? { 'Content-Type': 'application/json' } : {}) };
}

export async function postSync(apiBase: string, userId: string, body: SyncRequestBody, fetchImpl: Fetch = fetch): Promise<SyncResponseBody> {
  const response = await fetchImpl(`${apiBase}sync`, {
    method: 'POST',
    headers: headers(userId, true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as SyncResponseBody;
}

export async function deleteVault(apiBase: string, userId: string, fetchImpl: Fetch = fetch): Promise<void> {
  const response = await fetchImpl(`${apiBase}vault`, { method: 'DELETE', headers: headers(userId, false), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw await failure(response);
}
