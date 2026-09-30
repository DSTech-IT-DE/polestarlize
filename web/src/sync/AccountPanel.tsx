import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getUserId } from '../lib/identity';

/** Shows the anonymous ID. Extended with sync controls when a sync server is available. */
export function AccountPanel() {
  const { t } = useTranslation('settings');
  const [copied, setCopied] = useState(false);
  const id = getUserId();
  return (
    <div className="panel">
      <div className="label">{t('account.id')}</div>
      <div className="account-id">
        <code>{id}</code>
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={() => void navigator.clipboard.writeText(id).then(() => setCopied(true))}
        >
          {copied ? t('account.copied') : t('account.copy')}
        </button>
      </div>
      <p className="field-hint">{t('account.localOnly')}</p>
    </div>
  );
}
