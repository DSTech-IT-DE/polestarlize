import { useTranslation } from 'react-i18next';
import { href } from '../lib/router';
import { loadDemoData } from '../store/repository';

/** Shown on analysis pages while no trips are stored. */
export function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="empty">
      <h2>{t('empty.title')}</h2>
      <p>{t('empty.body')}</p>
      <div className="page-actions">
        <a className="button" href={href('import')}>
          {t('empty.import')}
        </a>
        <button type="button" className="button button-secondary" onClick={() => void loadDemoData()}>
          {t('empty.demo')}
        </button>
      </div>
    </div>
  );
}
