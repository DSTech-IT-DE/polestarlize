import { useSyncExternalStore } from 'react';

export type SyncMode = 'local' | 'server';
export type SyncStatusKind = 'idle' | 'syncing' | 'error' | 'offline';

export interface SyncState {
  /** False until the first server detection has finished. */
  detected: boolean;
  mode: SyncMode;
  status: SyncStatusKind;
  /** Epoch milliseconds of the last successful sync in this session. */
  lastSyncAt: number | null;
  /** Technical detail of the last failure (English, for tooltips). */
  error: string | null;
  /** Resolved API base URL (ends with `/api/v1/`) while in server mode. */
  apiBase: string | null;
  serverVersion: string | null;
}

let state: SyncState = {
  detected: false,
  mode: 'local',
  status: 'idle',
  lastSyncAt: null,
  error: null,
  apiBase: null,
  serverVersion: null,
};

const listeners = new Set<() => void>();

export function getSyncState(): SyncState {
  return state;
}

export function patchSyncState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribe, getSyncState, getSyncState);
}
