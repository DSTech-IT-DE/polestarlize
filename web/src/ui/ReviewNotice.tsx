import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { href } from '../lib/router';
import { useDataset } from '../store/dataset';
import { setTripReview } from '../store/repository';

/** Callout for suspicious trips that are held back from the analyses until the user decides. */
export function ReviewNotice({ showLink = true }: { showLink?: boolean }) {
  const { t } = useTranslation('trips');
  const { allRecordedTrips, checks, pendingReview } = useDataset();
  const [busy, setBusy] = useState(false);
  if (pendingReview === 0) return null;

  const excludeAll = async () => {
    setBusy(true);
    try {
      const ids = allRecordedTrips.filter((trip) => checks.get(trip.id)?.status === 'review').map((trip) => trip.id);
      await setTripReview(ids, 'exclude');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="note note-warning review-notice" role="status">
      <p>
        <strong>{t('review.notice.title', { count: pendingReview })}</strong> {t('review.notice.body', { count: pendingReview })}
      </p>
      <div className="review-notice-actions">
        {showLink && (
          <a className="button button-secondary button-small" href={href('trips', { status: 'review' })}>
            {t('review.notice.show')}
          </a>
        )}
        <button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => void excludeAll()}>
          {t('review.notice.excludeAll')}
        </button>
      </div>
    </div>
  );
}
