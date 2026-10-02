import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { capacitySamples, recentCapacity, stateOfHealth } from '../../analytics/battery';
import { monthlyTotals, totals } from '../../analytics/core';
import { consumptionPer100 } from '../../domain/trip';
import { shortAddress } from '../../lib/address';
import { useFormat } from '../../lib/format';
import { href } from '../../lib/router';
import { useSettings } from '../../lib/settings';
import { useDataset } from '../../store/dataset';
import { Chart } from '../../ui/chart/Chart';
import { barStyle, baseOption, categoryAxis, useChartTheme, valueAxis } from '../../ui/chart/theme';
import { EmptyState } from '../../ui/EmptyState';
import { Page, Panel, Section } from '../../ui/Page';
import { ReviewNotice } from '../../ui/ReviewNotice';
import { Stat, Stats } from '../../ui/Stat';

export default function OverviewPage() {
  const { t } = useTranslation('overview');
  const f = useFormat();
  const theme = useChartTheme();
  const { trips, allTrips, loading } = useDataset();
  const { usableCapacityKwh } = useSettings();

  const sum = useMemo(() => totals(trips), [trips]);
  const months = useMemo(() => monthlyTotals(trips), [trips]);
  const capacity = useMemo(() => recentCapacity(capacitySamples(allTrips)), [allTrips]);
  const health = capacity ? stateOfHealth(capacity.capacityKwh, usableCapacityKwh) : null;
  const recent = useMemo(() => trips.slice(-6).reverse(), [trips]);

  const distanceOption = useMemo(
    () => ({
      ...baseOption(theme),
      tooltip: { ...baseOption(theme).tooltip, valueFormatter: (v: number) => `${f.number(v)} ${f.distanceUnit}` },
      xAxis: categoryAxis(theme, months.map((m) => f.month(m.key))),
      yAxis: valueAxis(theme, { name: f.distanceUnit }),
      series: [
        {
          type: 'bar',
          name: t('distance'),
          data: months.map((m) => Math.round(f.distanceValue(m.distanceKm))),
          itemStyle: barStyle(theme.series[0]),
          barMaxWidth: 22,
          emphasis: { itemStyle: { color: theme.accent } },
        },
      ],
    }),
    [theme, months, f, t],
  );

  const consumptionOption = useMemo(
    () => ({
      ...baseOption(theme),
      tooltip: { ...baseOption(theme).tooltip, valueFormatter: (v: number | null) => (v == null ? '–' : `${f.number(v, 1)} ${f.consumptionUnit}`) },
      xAxis: categoryAxis(theme, months.map((m) => f.month(m.key)), { boundaryGap: false }),
      yAxis: valueAxis(theme, { name: f.consumptionUnit, scale: true }),
      series: [
        {
          type: 'line',
          name: t('consumption'),
          data: months.map((m) => (m.consumption == null ? null : Math.round(f.consumptionValue(m.consumption) * 10) / 10)),
          lineStyle: { width: 2, color: theme.series[1] },
          itemStyle: { color: theme.series[1], borderColor: theme.surface, borderWidth: 2 },
          symbolSize: 8,
          connectNulls: true,
        },
      ],
    }),
    [theme, months, f, t],
  );

  if (loading) return null;
  if (trips.length === 0) {
    return (
      <Page overline={t('overline')} title={t('title')} lead={t('leadEmpty')}>
        <ReviewNotice />
        <EmptyState />
      </Page>
    );
  }

  return (
    <Page
      overline={t('overline')}
      title={t('title')}
      lead={t('lead', { from: f.date(sum.firstStart!), to: f.date(sum.lastEnd!), days: sum.spanDays })}
      actions={
        <a className="button button-secondary" href={href('import')}>
          {t('importMore')}
        </a>
      }
    >
      <ReviewNotice />
      <Stats>
        <Stat
          label={t('distance')}
          value={f.number(f.distanceValue(sum.distanceKm))}
          unit={f.distanceUnit}
          hint={t('tripsOnDays', { trips: t('tripsCount', { count: sum.trips }), days: t('daysCount', { count: sum.activeDays }) })}
          accent
        />
        <Stat label={t('energy')} value={f.number(sum.energyKwh)} unit="kWh" />
        <Stat label={t('consumption')} value={sum.consumption == null ? '–' : f.number(f.consumptionValue(sum.consumption), 1)} unit={f.consumptionUnit} />
        <Stat label={t('drivingTime')} value={f.number(sum.drivingMinutes / 60)} unit="h" hint={sum.averageSpeed ? t('avgSpeed', { speed: f.speed(sum.averageSpeed) }) : undefined} />
        <Stat
          label={t('batteryHealth')}
          value={health == null ? '–' : f.number(health * 100)}
          unit={health == null ? undefined : '%'}
          hint={<a href={href('battery')}>{capacity ? t('batteryHint', { kwh: f.number(capacity.capacityKwh, 1) }) : t('batteryUnknown')}</a>}
        />
        <Stat label={t('odometer')} value={sum.odometerKm == null ? '–' : f.number(f.distanceValue(sum.odometerKm))} unit={f.distanceUnit} />
      </Stats>

      <Section title={t('monthly')}>
        <div className="grid grid-2">
          <Panel title={t('distancePerMonth')}>
            <Chart option={distanceOption} ariaLabel={t('distancePerMonth')} height={260} />
          </Panel>
          <Panel title={t('consumptionPerMonth')}>
            <Chart option={consumptionOption} ariaLabel={t('consumptionPerMonth')} height={260} />
          </Panel>
        </div>
      </Section>

      <Section
        title={t('recent')}
        aside={
          <a href={href('trips')} className="section-note">
            {t('allTrips')} →
          </a>
        }
      >
        <div className="panel panel-flush table-wrap">
          <table className="table table-wide">
            <thead>
              <tr>
                <th>{t('when')}</th>
                <th>{t('route')}</th>
                <th className="num">{t('distance')}</th>
                <th className="num">{t('consumption')}</th>
                <th className="num">{t('soc')}</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((trip) => {
                const c = consumptionPer100(trip);
                return (
                  <tr key={trip.id}>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {f.dateTime(trip.start)}
                    </td>
                    <td>
                      {shortAddress(trip.startAddress)} <span className="muted">→</span> {shortAddress(trip.endAddress)}
                    </td>
                    <td className="num">{f.distance(trip.distanceKm)}</td>
                    <td className="num">{c == null ? '–' : f.consumption(c)}</td>
                    <td className="num">
                      {trip.socStart ?? '–'} → {trip.socEnd ?? '–'} %
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </Page>
  );
}

export { shortAddress };
