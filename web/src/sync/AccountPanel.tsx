import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getUserId, isValidUserId } from '../lib/identity';
import { updateSettings, useSettings } from '../lib/settings';
import { useDataset } from '../store/dataset';
import { switchIdentity } from './account';
import { fetchHealth, resolveApiBase } from './api';
import { deleteServerData, syncNow } from './engine';
import { useSyncState } from './state';
import { serverLabel, useAgo } from './SyncStatus';
import './sync.css';

type Feedback = { kind: 'ok' | 'error'; text: string } | null;
type IdFlow = { kind: 'use'; input: string } | { kind: 'create' } | null;

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <span className={`account-feedback is-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
      {feedback.text}
    </span>
  );
}

function IdentityBlock() {
  const { t } = useTranslation('sync');
  const { t: ts } = useTranslation('settings');
  const state = useSyncState();
  const { allTrips } = useDataset();
  const [copied, setCopied] = useState(false);
  const [flow, setFlow] = useState<IdFlow>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Feedback>(null);
  const id = getUserId();
  const server = state.mode === 'server';

  const typed = flow?.kind === 'use' ? flow.input.trim() : '';
  const typedError = flow?.kind === 'use' && typed ? (!isValidUserId(typed) ? t('account.invalidId') : typed.toLowerCase() === id ? t('account.sameId') : null) : null;
  const canContinue = flow?.kind === 'create' || (flow?.kind === 'use' && typed !== '' && typedError === null);

  const close = () => {
    setFlow(null);
    setConfirming(false);
  };

  const apply = async () => {
    if (!flow) return;
    setBusy(true);
    try {
      await switchIdentity(flow.kind === 'use' ? typed : null);
      setDone({ kind: 'ok', text: t('account.switched') });
      setCopied(false);
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-block">
      <div>
        <div className="label">{ts('account.id')}</div>
        <div className="account-id">
          <code>{id}</code>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => void navigator.clipboard.writeText(id).then(() => setCopied(true))}
          >
            {copied ? ts('account.copied') : ts('account.copy')}
          </button>
        </div>
      </div>
      <p>{t('account.keyWarning')}</p>
      <p>
        {server
          ? t(state.apiBase && state.status !== 'syncing' && state.lastSyncAt === null && !state.error ? 'account.modeServerSyncing' : 'account.modeServer', {
              server: state.apiBase ? serverLabel(state.apiBase) : '',
            })
          : t('account.modeLocal')}
      </p>

      {!flow && (
        <div className="account-row">
          <button type="button" className="button button-secondary button-small" onClick={() => { setFlow({ kind: 'use', input: '' }); setDone(null); }}>
            {t('account.useOther')}
          </button>
          <button type="button" className="button button-secondary button-small" onClick={() => { setFlow({ kind: 'create' }); setConfirming(true); setDone(null); }}>
            {t('account.createNew')}
          </button>
          <FeedbackLine feedback={done} />
        </div>
      )}

      {flow?.kind === 'use' && !confirming && (
        <div className="field">
          <label className="label" htmlFor="account-existing-id">
            {t('account.existingId')}
          </label>
          <div className="account-row">
            <input
              id="account-existing-id"
              className="input mono"
              value={flow.input}
              placeholder={t('account.existingIdPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={typedError !== null}
              onChange={(e) => setFlow({ kind: 'use', input: e.target.value })}
            />
            <button type="button" className="button button-small" disabled={!canContinue} onClick={() => setConfirming(true)}>
              {t('account.continue')}
            </button>
            <button type="button" className="button button-secondary button-small" onClick={close}>
              {t('account.cancel')}
            </button>
          </div>
          {typedError && <span className="account-feedback is-error">{typedError}</span>}
        </div>
      )}

      {flow && confirming && (
        <div className="note note-warning" role="alertdialog" aria-label={t('account.continue')}>
          <p>{t(server ? 'account.confirmServer' : 'account.confirmLocal', { count: allTrips.length })}</p>
          {flow.kind === 'use' && <p><code>{typed.toLowerCase()}</code></p>}
          <div className="account-row">
            <button type="button" className="button button-danger button-small" disabled={busy} onClick={() => void apply()}>
              {flow.kind === 'use' ? t('account.confirmUse') : t('account.confirmCreate')}
            </button>
            <button type="button" className="button button-secondary button-small" disabled={busy} onClick={close}>
              {t('account.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ServerBlock() {
  const { t } = useTranslation('sync');
  const settings = useSettings();
  const [value, setValue] = useState(settings.syncServerUrl);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const test = async () => {
    setFeedback(null);
    let base: string;
    try {
      base = resolveApiBase(value);
    } catch {
      setFeedback({ kind: 'error', text: t('account.server.invalidUrl') });
      return;
    }
    setTesting(true);
    try {
      const health = await fetchHealth(base);
      setFeedback(health.sync ? { kind: 'ok', text: t('account.server.testOk', { version: health.version }) } : { kind: 'error', text: t('account.server.testNoSync') });
    } catch (error) {
      setFeedback({ kind: 'error', text: t('account.server.testFailed', { reason: error instanceof Error ? error.message : String(error) }) });
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    try {
      resolveApiBase(value);
    } catch {
      setFeedback({ kind: 'error', text: t('account.server.invalidUrl') });
      return;
    }
    updateSettings({ syncServerUrl: value.trim() });
    setFeedback({ kind: 'ok', text: t('account.server.saved') });
  };

  return (
    <div className="account-block">
      <h3>{t('account.server.title')}</h3>
      <p>{t('account.server.note')}</p>
      <div className="field">
        <label className="label" htmlFor="account-server-url">
          {t('account.server.label')}
        </label>
        <div className="account-row">
          <input
            id="account-server-url"
            className="input mono"
            type="url"
            inputMode="url"
            value={value}
            placeholder={t('account.server.placeholder')}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
          />
          <button type="button" className="button button-secondary button-small" disabled={testing} onClick={() => void test()}>
            {testing ? t('account.server.testing') : t('account.server.test')}
          </button>
          <button type="button" className="button button-small" disabled={value.trim() === settings.syncServerUrl.trim()} onClick={save}>
            {t('account.server.save')}
          </button>
        </div>
        <FeedbackLine feedback={feedback} />
      </div>
    </div>
  );
}

function SyncBlock() {
  const { t } = useTranslation('sync');
  const state = useSyncState();
  const ago = useAgo(state.lastSyncAt);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const remove = async () => {
    setBusy(true);
    try {
      await deleteServerData();
      setFeedback({ kind: 'ok', text: t('account.delete.done') });
    } catch (error) {
      setFeedback({ kind: 'error', text: t('account.delete.failed', { reason: error instanceof Error ? error.message : String(error) }) });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <div className="account-block">
        <div className="account-row">
          <button type="button" className="button button-secondary button-small" disabled={state.status === 'syncing'} onClick={() => void syncNow()}>
            {state.status === 'syncing' ? t('account.syncing') : t('account.syncNow')}
          </button>
          {state.status === 'error' || state.status === 'offline' ? (
            <span className="account-feedback is-error">{t('account.lastSyncError', { error: state.error ?? '' })}</span>
          ) : (
            state.lastSyncAt !== null && (
              <span className="account-feedback">{t('account.lastSync', { when: ago.text ?? t('account.justNow') })}</span>
            )
          )}
        </div>
      </div>
      <div className="account-block">
        <h3>{t('account.delete.title')}</h3>
        <p>{t('account.delete.note')}</p>
        <div className="account-row">
          {!confirming ? (
            <button type="button" className="button button-danger button-small" onClick={() => { setConfirming(true); setFeedback(null); }}>
              {t('account.delete.button')}
            </button>
          ) : (
            <>
              <button type="button" className="button button-danger button-small" disabled={busy} onClick={() => void remove()}>
                {t('account.delete.confirm')}
              </button>
              <button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => setConfirming(false)}>
                {t('account.cancel')}
              </button>
            </>
          )}
          <FeedbackLine feedback={feedback} />
        </div>
      </div>
    </>
  );
}

/** The anonymous ID, how it is used, and the controls for switching it and for the sync server. */
export function AccountPanel() {
  const state = useSyncState();
  return (
    <div className="panel account-panel">
      <IdentityBlock />
      <ServerBlock />
      {state.mode === 'server' && <SyncBlock />}
    </div>
  );
}
