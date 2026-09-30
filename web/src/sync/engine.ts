/** Orchestrates sync: mode detection, triggers, single-flight execution and retry backoff. */
import { getUserId } from '../lib/identity';
import { getSettings, subscribeSettings } from '../lib/settings';
import { onLocalChange } from '../store/repository';
import { deleteVault, fetchHealth, resolveApiBase, SyncHttpError } from './api';
import { CycleAbortedError, resetSyncPosition, runSyncCycle } from './cycle';
import { getSyncState, patchSyncState } from './state';

const DEBOUNCE_MS = 1500;
const INTERVAL_MS = 5 * 60_000;
const FOCUS_THROTTLE_MS = 15_000;
const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 5 * 60_000;

let started = false;
let detection: Promise<void> | null = null;
let detectedFor: string | null = null;
let inFlight: Promise<void> | null = null;
let rerun = false;
let failures = 0;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let lastAttemptAt = 0;
let paused = 0;

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isUnreachable(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError'));
}

/** Decides between server and local mode. A configured URL always means server mode; otherwise the origin is probed. */
async function detect(): Promise<void> {
  const configured = getSettings().syncServerUrl.trim();
  detectedFor = configured;
  let apiBase: string;
  try {
    apiBase = resolveApiBase(configured);
  } catch (error) {
    patchSyncState({ detected: true, mode: 'server', status: 'error', apiBase: null, error: describeError(error) });
    return;
  }

  if (configured) {
    // The user asked for this server explicitly: show failures instead of silently falling back to local mode.
    patchSyncState({ detected: true, mode: 'server', apiBase, status: 'syncing', error: null });
    try {
      const health = await fetchHealth(apiBase);
      patchSyncState({ serverVersion: health.version });
      if (!health.sync) patchSyncState({ status: 'error', error: 'Sync is disabled on this server' });
    } catch {
      // The sync cycle reports the actual problem.
    }
    return;
  }

  try {
    const health = await fetchHealth(apiBase);
    if (health.sync) {
      patchSyncState({ detected: true, mode: 'server', apiBase, serverVersion: health.version, error: null });
      return;
    }
  } catch {
    // No sync server on this origin (static hosting, offline): stay local.
  }
  patchSyncState({ detected: true, mode: 'local', status: 'idle', apiBase: null, serverVersion: null, error: null, lastSyncAt: null });
}

/** Runs server detection once per configured URL; pass `force` to probe again. */
export function ensureDetected(force = false): Promise<void> {
  const configured = getSettings().syncServerUrl.trim();
  if (force || !detection || detectedFor !== configured) {
    detection = detect();
  }
  return detection;
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
  retryTimer = setTimeout(() => void syncNow(), delay);
}

async function runOnce(): Promise<boolean> {
  if (paused > 0) return true;
  await ensureDetected();
  const { mode, apiBase } = getSyncState();
  if (mode !== 'server' || !apiBase) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    patchSyncState({ status: 'offline' });
    return false;
  }

  const userId = getUserId();
  const configured = getSettings().syncServerUrl.trim();
  lastAttemptAt = Date.now();
  patchSyncState({ status: 'syncing' });
  try {
    await runSyncCycle({
      apiBase,
      userId,
      isCurrent: () => getUserId() === userId && getSettings().syncServerUrl.trim() === configured,
    });
    failures = 0;
    clearTimeout(retryTimer);
    patchSyncState({ status: 'idle', lastSyncAt: Date.now(), error: null });
    return true;
  } catch (error) {
    if (error instanceof CycleAbortedError) return true;
    failures += 1;
    patchSyncState({ status: isUnreachable(error) ? 'offline' : 'error', error: describeError(error) });
    scheduleRetry();
    return false;
  }
}

/** Syncs now. Calls while a sync is running are folded into one follow-up round. */
export function syncNow(): Promise<void> {
  clearTimeout(debounceTimer);
  if (inFlight) {
    rerun = true;
    return inFlight;
  }
  inFlight = (async () => {
    try {
      do {
        rerun = false;
        if (!(await runOnce())) break;
      } while (rerun);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function syncSoon() {
  if (getSyncState().mode !== 'server' && getSyncState().detected) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void syncNow(), DEBOUNCE_MS);
}

/** Runs after the user changed the server URL: detect again and sync. */
export async function redetectAndSync(): Promise<void> {
  failures = 0;
  clearTimeout(retryTimer);
  await ensureDetected(true);
  await syncNow();
}

/** Lets the UI wait for a running sync, e.g. before destructive operations. */
export async function whenIdle(): Promise<void> {
  while (inFlight) await inFlight;
}

/**
 * Runs `task` while no sync round is active or can start. Needed whenever local data and
 * identity change together, so trips of one ID are never pushed to the vault of another.
 */
export async function withSyncPaused<T>(task: () => Promise<T>): Promise<T> {
  paused += 1;
  try {
    await whenIdle();
    return await task();
  } finally {
    paused -= 1;
  }
}

/** Deletes the vault on the server and forgets the local sync position. Local trips stay. */
export async function deleteServerData(): Promise<void> {
  await withSyncPaused(async () => {
    await ensureDetected();
    const { apiBase } = getSyncState();
    if (!apiBase) throw new Error('No sync server');
    const userId = getUserId();
    await deleteVault(apiBase, userId);
    await resetSyncPosition(apiBase, userId);
  });
}

export function startSync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  let lastUrl = getSettings().syncServerUrl.trim();
  let lastSettingsStamp = getSettings().updatedAt;
  subscribeSettings(() => {
    const settings = getSettings();
    if (settings.syncServerUrl.trim() !== lastUrl) {
      lastUrl = settings.syncServerUrl.trim();
      void redetectAndSync();
    } else if (settings.updatedAt !== lastSettingsStamp) {
      syncSoon();
    }
    lastSettingsStamp = settings.updatedAt;
  });

  onLocalChange(syncSoon);

  const maybeSync = () => {
    if (document.visibilityState === 'hidden') return;
    if (Date.now() - lastAttemptAt < FOCUS_THROTTLE_MS) return;
    void syncNow();
  };
  window.addEventListener('focus', maybeSync);
  document.addEventListener('visibilitychange', maybeSync);
  window.addEventListener('online', () => {
    failures = 0;
    // A server that was unreachable at startup may be reachable now.
    void (getSyncState().mode === 'local' ? redetectAndSync() : syncNow());
  });
  window.addEventListener('offline', () => {
    if (getSyncState().mode === 'server') patchSyncState({ status: 'offline' });
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, INTERVAL_MS);

  void syncNow();
}

export { SyncHttpError };
