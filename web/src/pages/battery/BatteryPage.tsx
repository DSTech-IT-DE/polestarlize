import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MIN_MONTH_DELTA_SOC,
  MIN_TRIP_DELTA_SOC,
  RECENT_DAYS,
  SCATTER_MIN_DELTA_SOC,
  SOC_BIN,
  capacitySamples,
  capacityTrend,
  estimateCapacity,
  monthlyCapacity,
  recentCapacity,
  socUsage,
  stateOfHealth,
} from '../../analytics/battery';
import { chargingSessions, chargingStats, MIN_CHARGE_GAIN } from '../../analytics/charging';
import { totals } from '../../analytics/core';
import { buildStints } from '../../analytics/stints';
import { toDate } from '../../domain/trip';
import { useFormat } from '../../lib/format';
import { useSettings } from '../../lib/settings';
import { useDataset } from '../../store/dataset';
import { Chart } from '../../ui/chart/Chart';
import { barStyle, baseOption, categoryAxis, timeAxis, useChartTheme, valueAxis } from '../../ui/chart/theme';
import { EmptyState } from '../../ui/EmptyState';
import { Page, Panel, Section } from '../../ui/Page';
import { Stat, Stats } from '../../ui/Stat';
import './battery.css';

const monthTime = (key: string) => toDate(`${key}-15T00:00`).getTime();

export default function BatteryPage() {
  const { t } = useTranslation('battery');
  const f = useFormat();
  const theme = useChartTheme();
  const { trips, allTrips, loading } = useDataset();
  const { usableCapacityKwh: nominal } = useSettings();

  // The capacity estimate always uses the whole history: a period filter would only make it noisier.
  const samples = useMemo(() => capacitySamples(allTrips), [allTrips]);
  const months = useMemo(() => monthlyCapacity(samples), [samples]);
  const recent = useMemo(() => recentCapacity(samples), [samples]);
  const overall = useMemo(() => estimateCapacity(samples), [samples]);
  const trend = useMemo(() => capacityTrend(months), [months]);
  const scatter = useMemo(() => capacitySamples(allTrips, SCATTER_MIN_DELTA_SOC), [allTrips]);
  const usage = useMemo(() => socUsage(trips, nominal), [trips, nominal]);
  const sessions = useMemo(() => chargingSessions(buildStints(trips), nominal), [trips, nominal]);
  const charge = useMemo(() => chargingStats(sessions, totals(trips).spanDays), [sessions, trips]);

  const soh = recent ? stateOfHealth(recent.capacityKwh, nominal) : null;
  const tip = useMemo(() => ({ ...baseOption(theme).tooltip }), [theme]);

  const dateLabel = useMemo(() => {
    const nf = new Intl.DateTimeFormat(f.locale, { month: 'short', year: '2-digit' });
    return (value: number) => nf.format(value);
  }, [f.locale]);

  const capacityOption = useMemo(() => {
    const est = t('chart.estimate');
    const band = t('chart.interval');
    const trendName = t('chart.trend');
    const lows = months.map((m) => m.low);
    const highs = months.map((m) => m.high);
    const min = Math.floor(Math.min(nominal, ...lows) - 1);
    const max = Math.ceil(Math.max(nominal, ...highs) + 1);
    const at = (i: number) => monthTime(months[i].key);
    return {
      ...baseOption(theme),
      grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
      legend: { top: 0, right: 0, itemWidth: 16, itemHeight: 8, textStyle: { color: theme.ink2, fontSize: 12 }, data: [est, { name: band, icon: 'rect', itemStyle: { color: theme.series[0], opacity: 0.35 } }, ...(trend ? [trendName] : [])] },
      tooltip: {
        ...tip,
        axisPointer: { ...tip.axisPointer, snap: true },
        formatter: (params: { seriesId?: string; dataIndex: number }[]) => {
          const p = params.find((x) => x.seriesId === 'estimate');
          if (!p) return '';
          const m = months[p.dataIndex];
          return [
            `<strong>${f.month(m.key, 'long')}</strong>`,
            `${est}: ${f.number(m.capacityKwh, 1)} kWh`,
            `${band}: ${f.number(m.low, 1)}–${f.number(m.high, 1)} kWh`,
            `${t('chart.basis', { points: f.number(m.sumDeltaSoc), count: m.n })}`,
          ].join('<br>');
        },
      },
      xAxis: timeAxis(theme, {
        axisLabel: { color: theme.muted, fontSize: 11, hideOverlap: true, formatter: dateLabel },
      }),
      yAxis: valueAxis(theme, { name: 'kWh', min, max, interval: undefined }),
      series: [
        {
          id: 'base',
          name: '_base',
          type: 'line',
          stack: 'band',
          data: months.map((m, i) => [at(i), m.low]),
          symbol: 'none',
          lineStyle: { opacity: 0 },
          silent: true,
          tooltip: { show: false },
        },
        {
          id: 'band',
          name: band,
          type: 'line',
          stack: 'band',
          data: months.map((m, i) => [at(i), m.high - m.low]),
          symbol: 'none',
          lineStyle: { opacity: 0 },
          areaStyle: { color: theme.series[0], opacity: 0.18 },
          itemStyle: { color: theme.series[0], opacity: 0.18 },
          silent: true,
        },
        {
          id: 'estimate',
          name: est,
          type: 'line',
          data: months.map((m, i) => [at(i), m.capacityKwh]),
          lineStyle: { width: 2, color: theme.series[0] },
          itemStyle: { color: theme.series[0], borderColor: theme.surface, borderWidth: 2 },
          symbolSize: 8,
          z: 3,
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: theme.muted, type: 'dashed', width: 1 },
            label: { formatter: t('chart.nominal', { value: f.number(nominal, 1) }), color: theme.muted, fontSize: 11, position: 'insideStartBottom' },
            data: [{ yAxis: nominal }],
          },
        },
        ...(trend
          ? [
              {
                id: 'trend',
                name: trendName,
                type: 'line',
                data: [
                  [monthTime(trend.line.from.key), trend.line.from.kwh],
                  [monthTime(trend.line.to.key), trend.line.to.kwh],
                ],
                symbol: 'none',
                lineStyle: { width: 2, color: theme.series[1], type: 'dashed' },
                itemStyle: { color: theme.series[1] },
                silent: true,
                z: 2,
              },
            ]
          : []),
      ],
    };
  }, [theme, tip, months, trend, nominal, f, t, dateLabel]);

  const scatterOption = useMemo(() => {
    const min = Math.floor(Math.min(nominal, ...scatter.map((s) => s.capacityKwh)) - 2);
    const max = Math.ceil(Math.max(nominal, ...scatter.map((s) => s.capacityKwh)) + 2);
    return {
      ...baseOption(theme),
      tooltip: {
        ...tip,
        trigger: 'item' as const,
        formatter: (p: { data: { start: string; value: [number, number]; delta: number; energy: number } }) =>
          [
            `<strong>${f.dateTime(p.data.start)}</strong>`,
            `${t('chart.estimate')}: ${f.number(p.data.value[1], 1)} kWh`,
            t('chart.tripBasis', { energy: f.number(p.data.energy, 1), points: p.data.delta }),
          ].join('<br>'),
      },
      xAxis: timeAxis(theme, { axisLabel: { color: theme.muted, fontSize: 11, hideOverlap: true, formatter: dateLabel } }),
      yAxis: valueAxis(theme, { name: 'kWh', min, max }),
      series: [
        {
          type: 'scatter',
          name: t('chart.estimate'),
          data: scatter.map((s) => ({ value: [toDate(s.start).getTime(), s.capacityKwh], start: s.start, delta: s.deltaSoc, energy: s.energyKwh })),
          symbolSize: 8,
          itemStyle: { color: theme.series[0], borderColor: theme.surface, borderWidth: 2 },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: theme.muted, type: 'dashed', width: 1 },
            label: { formatter: t('chart.nominal', { value: f.number(nominal, 1) }), color: theme.muted, fontSize: 11, position: 'insideStartBottom' },
            data: [{ yAxis: nominal }],
          },
        },
      ],
    };
  }, [theme, tip, scatter, nominal, f, t, dateLabel]);

  const usageOption = useMemo(() => {
    const labels = usage.startHistogram.map((_, i) => {
      const lo = i * SOC_BIN;
      return i === usage.startHistogram.length - 1 ? `${lo}–100` : `${lo}–${lo + SOC_BIN - 1}`;
    });
    const series = (name: string, data: number[], color: string) => ({
      type: 'bar',
      name,
      data,
      itemStyle: barStyle(color),
      barMaxWidth: 14,
      barGap: '10%',
    });
    return {
      ...baseOption(theme),
      grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
      legend: { top: 0, right: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: theme.ink2, fontSize: 12 } },
      tooltip: { ...tip, valueFormatter: (v: number) => t('usage.tripsValue', { count: v }) },
      xAxis: categoryAxis(theme, labels),
      yAxis: valueAxis(theme, { name: t('usage.tripsAxis') }),
      series: [series(t('usage.atStart'), usage.startHistogram, theme.series[0]), series(t('usage.atEnd'), usage.endHistogram, theme.series[1])],
    };
  }, [theme, tip, usage, t]);

  if (loading) return null;
  if (trips.length === 0) {
    return (
      <Page overline={t('overline')} title={t('title')} lead={t('lead')}>
        <EmptyState />
      </Page>
    );
  }

  const pct = (share: number | null) => (share == null ? '–' : f.percent(share * 100, share < 0.1 ? 1 : 0));
  const windowLabel = recent ? (recent.windowDays == null ? t('capacity.windowAll') : t('capacity.windowDays', { days: recent.windowDays })) : '';
  const careHigh = usage.shareStartAtLeast90 ?? 0;
  const careLow = usage.shareEndAtMost20 ?? 0;

  return (
    <Page overline={t('overline')} title={t('title')} lead={t('lead')}>
      <Stats>
        <Stat
          label={t('stats.capacity')}
          value={recent ? f.number(recent.capacityKwh, 1) : '–'}
          unit={recent ? 'kWh' : undefined}
          hint={recent ? t('stats.capacityHint', { low: f.number(recent.low, 1), high: f.number(recent.high, 1), window: windowLabel }) : t('stats.capacityNone')}
          accent
        />
        <Stat
          label={t('stats.soh')}
          value={soh == null ? '–' : f.number(soh * 100, 1)}
          unit={soh == null ? undefined : '%'}
          hint={soh == null ? undefined : soh > 1 ? t('stats.sohAbove') : t('stats.sohHint', { nominal: f.number(nominal, 1) })}
        />
        <Stat
          label={t('stats.trend')}
          value={trend ? f.number(trend.kwhPerYear, 1) : '–'}
          unit={trend ? t('stats.perYear') : undefined}
          hint={
            trend
              ? `${f.number(trend.percentPerYear, 1)} % ${t('stats.perYearShort')} · ${trend.significant ? t('stats.trendClear') : t('stats.trendNoise')}`
              : t('stats.trendNone')
          }
        />
        <Stat
          label={t('stats.cycles')}
          value={usage.equivalentCycles == null ? '–' : f.number(usage.equivalentCycles, 0)}
          hint={t('stats.cyclesHint', { energy: f.number(usage.energyKwh, 0) })}
        />
        <Stat label={t('stats.lowest')} value={usage.minSoc == null ? '–' : f.number(usage.minSoc)} unit={usage.minSoc == null ? undefined : '%'} hint={t('stats.lowestHint')} />
      </Stats>

      <div className="note note-warning bc-note">
        <strong>{t('honest.title')}</strong> {t('honest.body')}
      </div>

      <Section title={t('capacity.title')} note={t('capacity.note', { trip: MIN_TRIP_DELTA_SOC, month: MIN_MONTH_DELTA_SOC })}>
        {months.length === 0 ? (
          <div className="note">{t('capacity.tooLittle', { trip: MIN_TRIP_DELTA_SOC, month: MIN_MONTH_DELTA_SOC })}</div>
        ) : (
          <Panel title={t('capacity.monthly')}>
            <Chart option={capacityOption} ariaLabel={t('capacity.monthly')} height={300} />
          </Panel>
        )}
        <div className="grid grid-2" style={{ marginTop: 16 }}>
          <Panel title={t('capacity.perTrip', { points: SCATTER_MIN_DELTA_SOC })}>
            {scatter.length === 0 ? (
              <p className="muted">{t('capacity.perTripNone', { points: SCATTER_MIN_DELTA_SOC })}</p>
            ) : (
              <Chart option={scatterOption} ariaLabel={t('capacity.perTrip', { points: SCATTER_MIN_DELTA_SOC })} height={260} />
            )}
          </Panel>
          <Panel title={t('basis.title')} flush>
            <div className="table-wrap">
              <table className="table bc-facts">
                <tbody>
                  <tr>
                    <td>{t('basis.nominal')}</td>
                    <td className="num">{f.number(nominal, 1)} kWh</td>
                  </tr>
                  <tr>
                    <td>{t('basis.recent', { days: RECENT_DAYS })}</td>
                    <td className="num">{recent ? `${f.number(recent.capacityKwh, 1)} kWh` : '–'}</td>
                  </tr>
                  <tr>
                    <td>{t('basis.interval')}</td>
                    <td className="num">{recent ? `${f.number(recent.low, 1)}–${f.number(recent.high, 1)} kWh` : '–'}</td>
                  </tr>
                  <tr>
                    <td>{t('basis.overall')}</td>
                    <td className="num">{overall ? `${f.number(overall.capacityKwh, 1)} kWh` : '–'}</td>
                  </tr>
                  <tr>
                    <td>{t('basis.trips')}</td>
                    <td className="num">{f.number(samples.length)}</td>
                  </tr>
                  <tr>
                    <td>{t('basis.points')}</td>
                    <td className="num">{overall ? f.number(overall.sumDeltaSoc) : '–'}</td>
                  </tr>
                  <tr>
                    <td>{t('basis.months')}</td>
                    <td className="num">{f.number(months.length)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
        {trend && (
          <p className="section-note" style={{ marginTop: 12 }}>
            {t('capacity.trendNote', {
              slope: f.number(trend.kwhPerYear, 1),
              se: f.number(trend.kwhPerYearSe, 1),
              months: trend.months,
            })}
          </p>
        )}
      </Section>

      <Section title={t('usage.title')} note={t('usage.note')}>
        <div className="grid grid-2">
          <Panel title={t('usage.histogram')}>
            <Chart option={usageOption} ariaLabel={t('usage.histogram')} height={280} />
          </Panel>
          <Panel title={t('usage.facts')} flush>
            <div className="table-wrap">
              <table className="table bc-facts">
                <tbody>
                  <tr>
                    <td>{t('usage.startHigh')}</td>
                    <td className="num">{pct(usage.shareStartAtLeast90)}</td>
                  </tr>
                  <tr>
                    <td>{t('usage.endLow')}</td>
                    <td className="num">{pct(usage.shareEndAtMost20)}</td>
                  </tr>
                  <tr>
                    <td>{t('usage.chargeHigh')}</td>
                    <td className="num">{pct(charge.shareTo90)}</td>
                  </tr>
                  <tr>
                    <td>{t('usage.lowest')}</td>
                    <td className="num">{usage.minSoc == null ? '–' : `${f.number(usage.minSoc)} %`}</td>
                  </tr>
                  <tr>
                    <td>{t('usage.day')}</td>
                    <td className="num">
                      {usage.medianDayStart == null || usage.medianDayEnd == null
                        ? '–'
                        : `${f.number(usage.medianDayStart)} → ${f.number(usage.medianDayEnd)} %`}
                    </td>
                  </tr>
                  <tr>
                    <td>{t('usage.days')}</td>
                    <td className="num">{f.number(usage.days)}</td>
                  </tr>
                  <tr>
                    <td>{t('usage.throughput')}</td>
                    <td className="num">{f.number(usage.energyKwh, 0)} kWh</td>
                  </tr>
                  <tr>
                    <td>{t('usage.cycles')}</td>
                    <td className="num">{usage.equivalentCycles == null ? '–' : f.number(usage.equivalentCycles, 1)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </Section>

      <Section title={t('care.title')} note={t('care.note')}>
        <Panel>
          <div className="bc-care">
            {usage.trips === 0 ? (
              <p>{t('care.noSoc')}</p>
            ) : (
              <>
                <p>{t(careHigh >= 0.25 ? 'care.highMany' : 'care.highFew', { share: f.percent(careHigh * 100, careHigh < 0.1 ? 1 : 0) })}</p>
                <p>{t(careLow >= 0.15 ? 'care.lowMany' : 'care.lowFew', { share: f.percent(careLow * 100, careLow < 0.1 ? 1 : 0), min: usage.minSoc ?? 0 })}</p>
                {charge.sessions > 0 && charge.shareTo90 != null && (
                  <p>{t(charge.shareTo90 >= 0.5 ? 'care.chargeHigh' : 'care.chargeLow', { share: f.percent(charge.shareTo90 * 100, 0), count: charge.sessions, gain: MIN_CHARGE_GAIN })}</p>
                )}
              </>
            )}
          </div>
        </Panel>
      </Section>
    </Page>
  );
}
