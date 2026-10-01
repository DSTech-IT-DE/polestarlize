import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { categoryShares, drivingRecords, drivingStats, RECORD_MIN_KM, SHORT_TRIP_KM, tripSpeed } from '../../analytics/driving';
import { consumptionPer100, type Trip } from '../../domain/trip';
import { useFormat } from '../../lib/format';
import { href } from '../../lib/router';
import { useDataset } from '../../store/dataset';
import { EmptyState } from '../../ui/EmptyState';
import { Page, Panel, Section } from '../../ui/Page';
import { Stat } from '../../ui/Stat';
import { EfficiencySection, LengthSection } from './EfficiencySections';
import { WhenSection } from './WhenSection';
import './driving.css';

export default function DrivingPage() {
  const { t } = useTranslation('driving');
  const f = useFormat();
  const { trips, loading } = useDataset();

  const stats = useMemo(() => drivingStats(trips), [trips]);
  const records = useMemo(() => drivingRecords(trips), [trips]);
  const categories = useMemo(() => categoryShares(trips, 3), [trips]);

  if (loading) return null;
  if (trips.length === 0) {
    return (
      <Page overline={t('overline')} title={t('title')} lead={t('lead')}>
        <EmptyState />
      </Page>
    );
  }

  const tripLink = (date: string, label: string) => <a href={href('trips', { q: date.slice(0, 10) })}>{label}</a>;
  const tripRow = (label: string, trip: Trip | null, value: (trip: Trip) => string, detail?: (trip: Trip) => string) =>
    trip && (
      <tr key={label}>
        <td>{label}</td>
        <td className="num">
          {value(trip)}
          {detail && <small>{detail(trip)}</small>}
        </td>
        <td className="num">{tripLink(trip.start, f.dateTime(trip.start))}</td>
      </tr>
    );
  const minDistance = f.distance(RECORD_MIN_KM);
  const categoryName = (c: { category: string; isOther: boolean }) =>
    c.isOther ? t('categories.other') : c.category ? t(`categories.${c.category}`, { defaultValue: c.category }) : t('categories.empty');

  return (
    <Page overline={t('overline')} title={t('title')} lead={t('lead')}>
      <div className="stats dc-stats">
        <Stat label={t('stats.tripsPerDay')} value={stats.tripsPerActiveDay == null ? '–' : f.number(stats.tripsPerActiveDay, 1)} hint={t('stats.tripsPerDayHint', { count: stats.activeDays })} accent />
        <Stat label={t('stats.avgDistance')} value={stats.averageKm == null ? '–' : f.number(f.distanceValue(stats.averageKm), 1)} unit={f.distanceUnit} />
        <Stat label={t('stats.medianDistance')} value={stats.medianKm == null ? '–' : f.number(f.distanceValue(stats.medianKm), 1)} unit={f.distanceUnit} hint={t('stats.medianHint')} />
        <Stat
          label={t('stats.shortShare', { distance: f.distance(SHORT_TRIP_KM) })}
          value={stats.shortShare == null ? '–' : f.number(stats.shortShare * 100)}
          unit="%"
          hint={t('stats.shortShareHint')}
        />
        <Stat label={t('stats.avgSpeed')} value={stats.averageSpeed == null ? '–' : f.number(f.distanceValue(stats.averageSpeed))} unit={f.unit === 'mi' ? 'mph' : 'km/h'} hint={t('stats.avgSpeedHint')} />
        <Stat
          label={t('stats.longest')}
          value={stats.longestTrip ? f.number(f.distanceValue(stats.longestTrip.distanceKm)) : '–'}
          unit={f.distanceUnit}
          hint={stats.longestTrip ? f.date(stats.longestTrip.start) : undefined}
        />
        <Stat
          label={t('stats.busiest')}
          value={stats.busiestDay ? t('tripsCount', { count: stats.busiestDay.trips }) : '–'}
          hint={stats.busiestDay ? t('stats.busiestHint', { date: f.date(`${stats.busiestDay.date}T00:00`), distance: f.distance(stats.busiestDay.distanceKm) }) : undefined}
        />
        <Stat label={t('records.streak')} value={records.streak ? t('records.streakDays', { count: records.streak.days }) : '–'} hint={records.streak ? `${f.date(`${records.streak.from}T00:00`)} – ${f.date(`${records.streak.to}T00:00`)}` : undefined} />
      </div>

      <WhenSection trips={trips} />
      <LengthSection trips={trips} />
      <EfficiencySection trips={trips} />

      <Section title={t('records.title')}>
        <div className="grid">
          <Panel flush>
            <div className="table-wrap">
              <table className="table dc-records">
                <thead>
                  <tr>
                    <th>{t('records.record')}</th>
                    <th className="num">{t('records.value')}</th>
                    <th className="num">{t('records.when')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tripRow(t('records.longestTrip'), records.longestTrip, (x) => f.distance(x.distanceKm))}
                  {records.longestDay && (
                    <tr>
                      <td>{t('records.longestDay')}</td>
                      <td className="num">
                        {f.distance(records.longestDay.distanceKm)}
                        <small>{t('tripsCount', { count: records.longestDay.trips })}</small>
                      </td>
                      <td className="num">{tripLink(records.longestDay.date, f.date(`${records.longestDay.date}T00:00`))}</td>
                    </tr>
                  )}
                  {tripRow(t('records.mostEfficient', { distance: minDistance }), records.mostEfficientTrip, (x) => f.consumption(consumptionPer100(x)!), (x) => t('records.tripOfLength', { distance: f.distance(x.distanceKm) }))}
                  {tripRow(t('records.leastEfficient', { distance: minDistance }), records.leastEfficientTrip, (x) => f.consumption(consumptionPer100(x)!), (x) => t('records.tripOfLength', { distance: f.distance(x.distanceKm) }))}
                  {records.streak && (
                    <tr>
                      <td>{t('records.streak')}</td>
                      <td className="num">{t('records.streakDays', { count: records.streak.days })}</td>
                      <td className="num">
                        {tripLink(records.streak.from, f.date(`${records.streak.from}T00:00`))} – {f.date(`${records.streak.to}T00:00`)}
                      </td>
                    </tr>
                  )}
                  {records.mostTripsDay && (
                    <tr>
                      <td>{t('records.mostTrips')}</td>
                      <td className="num">{t('tripsCount', { count: records.mostTripsDay.trips })}</td>
                      <td className="num">{tripLink(records.mostTripsDay.date, f.date(`${records.mostTripsDay.date}T00:00`))}</td>
                    </tr>
                  )}
                  {tripRow(t('records.fastest', { distance: minDistance }), records.fastestTrip, (x) => f.speed(tripSpeed(x)!), (x) => t('records.tripOfLength', { distance: f.distance(x.distanceKm) }))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title={t('categories.title')}>
            <p className="dc-caption" style={{ marginTop: 0, marginBottom: 14 }}>
              {t('categories.note')}
            </p>
            <div className="dc-bars">
              {categories.map((c) => (
                <div className="dc-bar-row" key={c.isOther ? '\u0000other' : c.category}>
                  <div className="dc-bar-head">
                    <span>{categoryName(c)}</span>
                    <span className="num">
                      {f.distance(c.distanceKm)} · {f.percent(c.share * 100)}
                    </span>
                  </div>
                  <div className="meter" role="img" aria-label={`${categoryName(c)}: ${f.percent(c.share * 100)}`}>
                    <span style={{ width: `${Math.max(c.share * 100, 0.5)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </Section>
    </Page>
  );
}
