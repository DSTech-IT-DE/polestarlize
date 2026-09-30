import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { capacitySamples, recentCapacity } from '../../analytics/battery';
import {
  MIN_CHARGE_GAIN,
  MIN_STANDBY_HOURS,
  PLACE_RADIUS_M,
  chargingPlaces,
  chargingSessions,
  chargingStats,
  energyBalance,
  histogram,
  monthlyCharging,
  standbyDrain,
} from '../../analytics/charging';
import { monthRange, totals } from '../../analytics/core';
import { buildStints } from '../../analytics/stints';
import { useFormat } from '../../lib/format';
import { useSettings } from '../../lib/settings';
import { useDataset } from '../../store/dataset';
import { Chart } from '../../ui/chart/Chart';
import { barStyle, baseOption, categoryAxis, useChartTheme, valueAxis } from '../../ui/chart/theme';
import { EmptyState } from '../../ui/EmptyState';
import { Page, Panel, Section } from '../../ui/Page';
import { Stat, Stats } from '../../ui/Stat';
import './charging.css';

const PLACE_ROWS = 10;
const CHART_PLACES = 5;
const RECENT_ROWS = 8;
const SOC_BIN_WIDTH = 10;
const DRAIN_BINS = 7;

export default function ChargingPage() {
  const { t } = useTranslation('charging');
  const f = useFormat();
  const theme = useChartTheme();
  const { trips, allTrips, loading } = useDataset();
  const { usableCapacityKwh: nominal } = useSettings();

  // Energy per SOC point depends on the usable capacity; prefer the measured one over the nominal value.
  const measured = useMemo(() => recentCapacity(capacitySamples(allTrips)), [allTrips]);
  const capacity = measured?.capacityKwh ?? nominal;

  const sum = useMemo(() => totals(trips), [trips]);
  const stints = useMemo(() => buildStints(trips), [trips]);
  const sessions = useMemo(() => chargingSessions(stints, capacity), [stints, capacity]);
  const stats = useMemo(() => chargingStats(sessions, sum.spanDays), [sessions, sum.spanDays]);
  const places = useMemo(() => chargingPlaces(sessions), [sessions]);
  const standby = useMemo(() => standbyDrain(stints, capacity), [stints, capacity]);
  const balance = useMemo(() => energyBalance(sum.energyKwh, stints, sessions, capacity), [sum.energyKwh, stints, sessions, capacity]);
  const monthKeys = useMemo(() => (trips.length ? monthRange(trips[0].start.slice(0, 7), trips[trips.length - 1].start.slice(0, 7)) : []), [trips]);
  const monthly = useMemo(() => monthlyCharging(sessions, monthKeys), [sessions, monthKeys]);
  const recent = useMemo(() => [...sessions].reverse().slice(0, RECENT_ROWS), [sessions]);

  const tip = useMemo(() => ({ ...baseOption(theme).tooltip }), [theme]);
  const placeName = (label: string) => label || t('places.unknown');
  const placeOfSession = useMemo(() => new Map(places.flatMap((p) => p.sessionKeys.map((k) => [k, p.label] as const))), [places]);

  const monthlyOption = useMemo(
    () => ({
      ...baseOption(theme),
      tooltip: {
        ...tip,
        formatter: (params: { dataIndex: number }[]) => {
          const m = monthly[params[0].dataIndex];
          return [`<strong>${f.month(m.key, 'long')}</strong>`, t('sessions.tooltipSessions', { count: m.sessions }), `${f.number(m.energyKwh, 0)} kWh`].join('<br>');
        },
      },
      xAxis: categoryAxis(theme, monthly.map((m) => f.month(m.key))),
      yAxis: valueAxis(theme, { name: t('sessions.axis'), minInterval: 1 }),
      series: [{ type: 'bar', name: t('sessions.axis'), data: monthly.map((m) => m.sessions), itemStyle: barStyle(theme.series[0]), barMaxWidth: 22 }],
    }),
    [theme, tip, monthly, f, t],
  );

  const socOption = useMemo(() => {
    const before = histogram(sessions.map((s) => s.socBefore), SOC_BIN_WIDTH);
    const after = histogram(sessions.map((s) => s.socAfter), SOC_BIN_WIDTH);
    const labels = before.map((_, i) => (i === before.length - 1 ? `${i * SOC_BIN_WIDTH}–100` : `${i * SOC_BIN_WIDTH}–${i * SOC_BIN_WIDTH + SOC_BIN_WIDTH - 1}`));
    const bar = (name: string, data: number[], color: string) => ({ type: 'bar', name, data, itemStyle: barStyle(color), barMaxWidth: 18, barGap: '10%' });
    return {
      ...baseOption(theme),
      grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
      legend: { top: 0, right: 0, itemWidth: 12, itemHeight: 8, textStyle: { color: theme.ink2, fontSize: 12 } },
      tooltip: { ...tip, valueFormatter: (v: number) => t('sessions.tooltipSessions', { count: v }) },
      xAxis: categoryAxis(theme, labels),
      yAxis: valueAxis(theme, { name: t('sessions.axis'), minInterval: 1 }),
      series: [bar(t('sessions.before'), before, theme.series[0]), bar(t('sessions.after'), after, theme.series[1])],
    };
  }, [theme, tip, sessions, t]);

  const placesOption = useMemo(() => {
    const top = places.slice(0, CHART_PLACES);
    const rest = places.slice(CHART_PLACES).reduce((a, p) => a + p.energyKwh, 0);
    const rows = [...top.map((p) => ({ name: p.label || t('places.unknown'), value: p.energyKwh })), ...(rest > 0 ? [{ name: t('places.other'), value: rest }] : [])].reverse();
    return {
      ...baseOption(theme),
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      tooltip: { ...tip, trigger: 'item' as const, valueFormatter: (v: number) => `${f.number(v, 0)} kWh` },
      xAxis: valueAxis(theme, { name: 'kWh', nameLocation: 'end', splitNumber: 3 }),
      yAxis: {
        ...categoryAxis(theme, rows.map((r) => r.name)),
        axisLabel: { color: theme.ink2, fontSize: 11.5, width: 150, overflow: 'truncate' as const },
      },
      series: [{ type: 'bar', name: 'kWh', data: rows.map((r) => r.value), itemStyle: barStyle(theme.series[0], true), barMaxWidth: 18 }],
    };
  }, [theme, tip, places, f, t]);

  const drainOption = useMemo(() => {
    const counts = histogram(standby.rates.map((r) => Math.max(0, r)), 1, DRAIN_BINS);
    const labels = counts.map((_, i) => (i === counts.length - 1 ? `${i}+` : `${i}–${i + 1}`));
    return {
      ...baseOption(theme),
      tooltip: { ...tip, valueFormatter: (v: number) => t('standby.tooltipStops', { count: v }) },
      xAxis: categoryAxis(theme, labels),
      yAxis: valueAxis(theme, { name: t('standby.axis'), minInterval: 1 }),
      series: [{ type: 'bar', name: t('standby.axis'), data: counts, itemStyle: barStyle(theme.series[0]), barMaxWidth: 28 }],
    };
  }, [theme, tip, standby, t]);

  if (loading) return null;
  if (trips.length === 0) {
    return (
      <Page overline={t('overline')} title={t('title')} lead={t('lead')}>
        <EmptyState />
      </Page>
    );
  }

  const dash = '–';
  const capacityNote = measured
    ? t('note.capacityMeasured', { capacity: f.number(capacity, 1), days: measured.windowDays ?? '' })
    : t('note.capacityNominal', { capacity: f.number(capacity, 1) });
  const shareOf = (share: number) => f.percent(share * 100, 0);

  return (
    <Page overline={t('overline')} title={t('title')} lead={t('lead')}>
      <Stats>
        <Stat label={t('stats.sessions')} value={f.number(stats.sessions)} hint={t('stats.sessionsHint', { gain: MIN_CHARGE_GAIN })} accent />
        <Stat label={t('stats.perWeek')} value={stats.sessionsPerWeek == null ? dash : f.number(stats.sessionsPerWeek, 1)} />
        <Stat label={t('stats.energy')} value={f.number(stats.energyKwh, 0)} unit="kWh" hint={t('stats.energyHint')} />
        <Stat
          label={t('stats.socRange')}
          value={stats.avgSocBefore == null || stats.avgSocAfter == null ? dash : `${f.number(stats.avgSocBefore, 0)} → ${f.number(stats.avgSocAfter, 0)}`}
          unit={stats.avgSocBefore == null ? undefined : '%'}
          hint={t('stats.socRangeHint')}
        />
        <Stat label={t('stats.to90')} value={stats.shareTo90 == null ? dash : f.number(stats.shareTo90 * 100, 0)} unit={stats.shareTo90 == null ? undefined : '%'} hint={t('stats.to90Hint')} />
        <Stat label={t('stats.gain')} value={stats.avgGain == null ? dash : f.number(stats.avgGain, 0)} unit={stats.avgGain == null ? undefined : t('stats.points')} hint={stats.medianGain == null ? undefined : t('stats.gainHint', { median: f.number(stats.medianGain, 0) })} />
      </Stats>

      <div className="note bc-note">
        <strong>{t('note.title')}</strong> {t('note.body', { gain: MIN_CHARGE_GAIN })} {capacityNote}
      </div>

      {sessions.length === 0 ? (
        <Section title={t('sessions.title')}>
          <div className="note">{t('sessions.none', { gain: MIN_CHARGE_GAIN })}</div>
        </Section>
      ) : (
        <>
          <Section title={t('sessions.title')} note={t('sessions.note')}>
            <div className="grid grid-2">
              <Panel title={t('sessions.perMonth')}>
                <Chart option={monthlyOption} ariaLabel={t('sessions.perMonth')} height={260} />
              </Panel>
              <Panel title={t('sessions.socTitle')}>
                <Chart option={socOption} ariaLabel={t('sessions.socTitle')} height={260} />
              </Panel>
            </div>
          </Section>

          <Section title={t('places.title')} note={t('places.note', { radius: PLACE_RADIUS_M })}>
            <div className="bc-places">
              <Panel title={t('places.table')} flush>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('places.place')}</th>
                        <th className="num">{t('places.sessions')}</th>
                        <th className="num">{t('places.energy')}</th>
                        <th className="num">{t('places.soc')}</th>
                        <th>{t('places.share')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {places.slice(0, PLACE_ROWS).map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="bc-place">
                              <span>{placeName(p.label)}</span>
                              {p.likelyHome && <span className="tag tag-accent">{t('places.home')}</span>}
                            </div>
                          </td>
                          <td className="num">{f.number(p.sessions)}</td>
                          <td className="num">{f.number(p.energyKwh, 0)} kWh</td>
                          <td className="num">
                            {f.number(p.avgSocBefore, 0)} → {f.number(p.avgSocAfter, 0)} %
                          </td>
                          <td>
                            <div className="bc-cell-meter">
                              <div className="meter" role="presentation">
                                <span style={{ width: `${Math.round(p.shareOfEnergy * 100)}%` }} />
                              </div>
                              <span className="num">{shareOf(p.shareOfEnergy)}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {places.length > PLACE_ROWS && <p className="section-note" style={{ padding: '10px 20px 14px' }}>{t('places.more', { count: places.length - PLACE_ROWS })}</p>}
              </Panel>
              <Panel title={t('places.breakdown')}>
                <Chart option={placesOption} ariaLabel={t('places.breakdown')} height={Math.max(180, 44 * Math.min(places.length, CHART_PLACES + 1) + 40)} />
              </Panel>
            </div>
          </Section>

          <Section title={t('recent.title')} note={t('recent.note')}>
            <div className="panel panel-flush table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('recent.parked')}</th>
                    <th>{t('places.place')}</th>
                    <th className="num">{t('places.soc')}</th>
                    <th className="num">{t('recent.gain')}</th>
                    <th className="num">{t('recent.energy')}</th>
                    <th className="num">{t('recent.window')}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((s) => (
                    <tr key={s.from}>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {f.dateTime(s.from)}
                      </td>
                      <td>{placeName(placeOfSession.get(s.from) ?? '')}</td>
                      <td className="num">
                        {s.socBefore} → {s.socAfter} %
                      </td>
                      <td className="num">+{s.gain}</td>
                      <td className="num">{f.number(s.energyKwh, 1)} kWh</td>
                      <td className="num">{f.duration(s.parkedMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}

      <Section title={t('standby.title')} note={t('standby.note', { hours: MIN_STANDBY_HOURS })}>
        {standby.stints === 0 ? (
          <div className="note">{t('standby.none', { hours: MIN_STANDBY_HOURS })}</div>
        ) : (
          <>
            <Stats>
              <Stat label={t('standby.pct')} value={f.number(standby.pooledPctPerDay ?? 0, 1)} unit="%/d" hint={t('standby.pctHint')} accent />
              <Stat label={t('standby.kwh')} value={f.number(standby.pooledKwhPerDay ?? 0, 2)} unit="kWh/d" />
              <Stat label={t('standby.stops')} value={f.number(standby.stints)} hint={t('standby.stopsHint', { days: f.number(standby.totalDays, 0) })} />
              <Stat label={t('standby.median')} value={f.number(standby.medianPctPerDay ?? 0, 1)} unit="%/d" hint={t('standby.medianHint')} />
            </Stats>
            <div style={{ marginTop: 16 }}>
              <Panel title={t('standby.distribution')}>
                <Chart option={drainOption} ariaLabel={t('standby.distribution')} height={220} />
              </Panel>
            </div>
          </>
        )}
      </Section>

      <Section title={t('balance.title')} note={t('balance.note')}>
        <div className="grid grid-2">
          <Panel title={t('balance.table')} flush>
            <div className="table-wrap">
              <table className="table bc-facts">
                <tbody>
                  <tr>
                    <td>{t('balance.used')}</td>
                    <td className="num">{f.number(balance.usedKwh, 0)} kWh</td>
                  </tr>
                  <tr>
                    <td>{t('balance.charged')}</td>
                    <td className="num">{f.number(balance.chargedKwh, 0)} kWh</td>
                  </tr>
                  <tr>
                    <td>{t('balance.standby')}</td>
                    <td className="num">{f.number(balance.standbyKwh, 0)} kWh</td>
                  </tr>
                  <tr className="bc-total">
                    <td>{t('balance.difference')}</td>
                    <td className="num">
                      {balance.chargedKwh - balance.usedKwh >= 0 ? '+' : ''}
                      {f.number(balance.chargedKwh - balance.usedKwh, 0)} kWh
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Panel>
          <div className="note">
            <p>{t('balance.explain')}</p>
            <p style={{ marginTop: 8 }}>{t('balance.gaps', { gaps: balance.gapStints, total: balance.stints })}</p>
          </div>
        </div>
      </Section>
    </Page>
  );
}
