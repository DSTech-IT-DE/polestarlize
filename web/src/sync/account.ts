import { isValidUserId, newUserId, setUserId } from '../lib/identity';
import { deleteAllTrips } from '../store/repository';
import { resetSyncPosition } from './cycle';
import { syncNow, withSyncPaused } from './engine';
import { getSyncState } from './state';

/**
 * Switches this browser to another ID. Local trips belong to the old ID and are dropped
 * without telling the server; with a sync server the new ID's trips are pulled afterwards.
 * Pass `null` to generate a fresh ID.
 */
export async function switchIdentity(id: string | null): Promise<string> {
  if (id !== null && !isValidUserId(id)) throw new Error('Invalid ID');
  const next = await withSyncPaused(async () => {
    let userId: string;
    if (id === null) {
      userId = newUserId();
    } else {
      userId = id.trim().toLowerCase();
      setUserId(userId);
    }
    await deleteAllTrips({ propagate: false });
    const { apiBase } = getSyncState();
    if (apiBase) await resetSyncPosition(apiBase, userId);
    return userId;
  });
  void syncNow();
  return next;
}
