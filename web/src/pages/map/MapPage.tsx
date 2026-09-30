import { useTranslation } from 'react-i18next';
import { useDataset } from '../../store/dataset';
import { EmptyState } from '../../ui/EmptyState';
import { Page } from '../../ui/Page';

export default function MapPage() {
  const { t } = useTranslation('map');
  const { trips, loading } = useDataset();
  if (loading) return null;
  return (
    <Page overline={t('overline')} title={t('title')} lead={t('lead')}>
      {trips.length === 0 ? <EmptyState /> : <p className="muted">{trips.length}</p>}
    </Page>
  );
}
