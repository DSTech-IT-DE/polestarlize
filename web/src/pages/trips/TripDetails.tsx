import { useTranslation } from 'react-i18next';
import { durationMinutes, type Trip } from '../../domain/trip';
import type { Formatter } from '../../lib/format';

const osmLink = (lat: number, lon: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;

function Coordinates({ lat, lon }: { lat: number | null; lon: number | null }) {
  if (lat == null || lon == null) return <span className="muted">–</span>;
  return (
    <a className="mono" href={osmLink(lat, lon)} target="_blank" rel="noopener noreferrer">
      {lat.toFixed(5)}, {lon.toFixed(5)}
    </a>
  );
}

/** Everything the table row has no room for. */
export function TripDetails({ trip, f }: { trip: Trip; f: Formatter }) {
  const { t } = useTranslation('trips');
  const minutes = durationMinutes(trip);
  const speed = minutes > 0 ? trip.distanceKm / (minutes / 60) : null;
  const socUsed = trip.socStart != null && trip.socEnd != null ? trip.socStart - trip.socEnd : null;
  return (
    <dl className="trip-details">
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
