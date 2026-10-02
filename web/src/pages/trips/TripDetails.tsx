import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MIN_CONSUMPTION_KWH_PER_100KM, minimumConsumption, type TripCheck, type TripIssue } from '../../analytics/plausibility';
import { durationMinutes, type Trip } from '../../domain/trip';
import type { Formatter } from '../../lib/format';
import { useSettings } from '../../lib/settings';
import { setTripReview } from '../../store/repository';

const osmLink = (lat: number, lon: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;

function Coordinates({ lat, lon }: { lat: number | null; lon: number | null }) {
  if (lat == null || lon == null) return <span className="muted">–</span>;
  return (
    <a className="mono" href={osmLink(lat, lon)} target="_blank" rel="noopener noreferrer">
      {lat.toFixed(5)}, {lon.toFixed(5)}
    </a>
  );
}

function IssueText({ issue, trip, f }: { issue: TripIssue; trip: Trip; f: Formatter }) {
  const { t } = useTranslation('trips');
  const { usableCapacityKwh } = useSettings();
  const limit = `${f.number(f.consumptionValue(MIN_CONSUMPTION_KWH_PER_100KM))} ${f.consumptionUnit}`;
  switch (issue) {
    case 'low-consumption': {
      const consumption = minimumConsumption(trip, { capacityKwh: usableCapacityKwh });
      const value = consumption ? `${f.number(f.consumptionValue(consumption.value), 1)} ${f.consumptionUnit}` : '–';
      return <>{t(consumption?.source === 'soc' ? 'review.issue.lowConsumptionSoc' : 'review.issue.lowConsumption', { value, limit })}</>;
    }
    case 'long-duration':
      return <>{t('review.issue.longDuration', { duration: f.duration(durationMinutes(trip)) })}</>;
    case 'too-fast':
      return <>{t('review.issue.tooFast', { speed: f.speed(trip.distanceKm / (durationMinutes(trip) / 60)) })}</>;
    case 'odometer-mismatch':
      return (
        <>
          {t('review.issue.odometerMismatch', {
            odometer: f.distance((trip.endOdometerKm ?? 0) - (trip.startOdometerKm ?? 0)),
            distance: f.distance(trip.distanceKm),
          })}
        </>
      );
    case 'soc-gain':
      return <>{t('review.issue.socGain', { gain: f.number((trip.socEnd ?? 0) - (trip.socStart ?? 0)) })}</>;
  }
}

/** Plausibility findings and the include/exclude decision. */
function TripReviewBlock({ trip, check, f }: { trip: Trip; check: TripCheck; f: Formatter }) {
  const { t } = useTranslation('trips');
  const [busy, setBusy] = useState(false);
  const decide = async (counted: boolean) => {
    setBusy(true);
    try {
      // A trip without findings needs no explicit "include"; dropping the decision keeps the record clean.
      await setTripReview([trip.id], counted ? (check.issues.length > 0 ? 'include' : undefined) : 'exclude');
    } finally {
      setBusy(false);
    }
  };

  const state = check.status === 'review' ? 'pending' : check.status === 'excluded' ? 'excluded' : check.issues.length > 0 ? 'included' : 'normal';
  return (
    <div className={`trip-details-wide trip-review trip-review-${state}`}>
      <dt className="label">{t('review.label')}</dt>
      {check.issues.length > 0 && (
        <dd>
          <ul className="trip-review-issues">
            {check.issues.map((issue) => (
              <li key={issue}>
                <IssueText issue={issue} trip={trip} f={f} />
              </li>
            ))}
          </ul>
        </dd>
      )}
      <dd className="trip-review-state">
        <span>{t(`review.state.${state}`)}</span>
        <span className="trip-review-actions">
          {check.status !== 'ok' && (
            <button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => void decide(true)}>
              {t(check.status === 'excluded' ? 'review.action.restore' : 'review.action.include')}
            </button>
          )}
          {check.status !== 'excluded' && (
            <button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => void decide(false)}>
              {t('review.action.exclude')}
            </button>
          )}
        </span>
      </dd>
    </div>
  );
}

/** Everything the table row has no room for. */
export function TripDetails({ trip, check, f }: { trip: Trip; check: TripCheck | undefined; f: Formatter }) {
  const { t } = useTranslation('trips');
  const minutes = durationMinutes(trip);
  const speed = minutes > 0 ? trip.distanceKm / (minutes / 60) : null;
  const socUsed = trip.socStart != null && trip.socEnd != null ? trip.socStart - trip.socEnd : null;
  return (
    <dl className="trip-details">
      {check && <TripReviewBlock trip={trip} check={check} f={f} />}
      <div>
        <dt className="label">{t('details.from')}</dt>
        <dd>{trip.startAddress || '–'}</dd>
        <dd>
          <Coordinates lat={trip.startLat} lon={trip.startLon} />
        </dd>
      </div>
      <div>
        <dt className="label">{t('details.to')}</dt>
        <dd>{trip.endAddress || '–'}</dd>
        <dd>
          <Coordinates lat={trip.endLat} lon={trip.endLon} />
        </dd>
      </div>
      <div>
        <dt className="label">{t('details.time')}</dt>
        <dd className="mono">
          {f.dateTime(trip.start)} → {f.dateTime(trip.end)}
        </dd>
        <dd className="mono">{speed == null ? '–' : t('details.avgSpeed', { speed: f.speed(speed) })}</dd>
      </div>
      <div>
        <dt className="label">{t('details.odometer')}</dt>
        <dd className="mono">
          {trip.startOdometerKm == null ? '–' : f.number(f.distanceValue(trip.startOdometerKm))} →{' '}
          {trip.endOdometerKm == null ? '–' : f.number(f.distanceValue(trip.endOdometerKm))} {f.distanceUnit}
        </dd>
        <dd className="mono">
          {socUsed == null ? '–' : t('details.socUsed', { used: f.number(socUsed), from: trip.socStart, to: trip.socEnd })}
        </dd>
      </div>
      {trip.comment && (
        <div className="trip-details-wide">
          <dt className="label">{t('details.comment')}</dt>
          <dd>{trip.comment}</dd>
        </div>
      )}
    </dl>
  );
}
