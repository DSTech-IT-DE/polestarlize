import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SyncIcon } from '../ui/icons';
import { syncNow } from './engine';
import { useSyncState } from './state';
import './sync.css';

export function serverLabel(apiBase: string): string {
  try {
    return new URL(apiBase).host;
  } catch {
    return apiBase;
  }
}

/** "2 min ago" style text in the current UI language, or null when it happened within the last minute. */
export function useAgo(timestamp: number | null): { text: string | null } {
  const { i18n } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(id);
  }, []);
  if (timestamp === null) return { text: null };
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return { text: null };
  const rtf = new Intl.RelativeTimeFormat(i18n.resolvedLanguage, { numeric: 'always', style: 'short' });
  if (seconds < 3600) return { text: rtf.format(-Math.max(1, Math.round(seconds / 60)), 'minute') };
  if (seconds < 86400) return { text: rtf.format(-Math.round(seconds / 3600), 'hour') };
  return { text: rtf.format(-Math.round(seconds / 86400), 'day') };
}

/** Compact sync indicator in the top bar. Renders nothing while no sync server is in use. */
export function SyncStatus() {
  const { t } = useTranslation('sync');
  const state = useSyncState();
  const ago = useAgo(state.lastSyncAt);
  if (state.mode !== 'server') return null;

  const server = state.apiBase ? serverLabel(state.apiBase) : '';
  let label: string;
  if (state.status === 'syncing') label = t('status.syncing');
  else if (state.status === 'offline') label = t('status.offline');
  else if (state.status === 'error') label = t('status.error');
  else if (state.lastSyncAt === null) label = t('status.neverSynced');
  else label = ago.text ? t('status.synced', { when: ago.text }) : t('status.syncedNow');

  const title = state.status === 'error' || state.status === 'offline' ? t('status.errorTitle', { error: state.error ?? '' }) : t('status.title', { server });
  return (
    <button
      type="button"
      className={`sync-status sync-${state.status}`}
      onClick={() => void syncNow()}
      title={title}
      aria-label={`${label}. ${title}`}
      disabled={state.status === 'syncing'}
    >
      <SyncIcon className={state.status === 'syncing' ? 'sync-spin' : undefined} />
      <span className="sync-status-text">{label}</span>
    </button>
  );
}
