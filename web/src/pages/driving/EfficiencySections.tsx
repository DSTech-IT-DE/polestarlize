import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  consumptionByMonthOfYear,
  lengthBins,
  LENGTH_EDGES_KM,
  MIN_BIN_SAMPLES,
  SPEED_EDGES_KMH,
  speedBins,
  type TripBin,
} from '../../analytics/driving';
import type { Trip } from '../../domain/trip';
import { useFormat, type Formatter } from '../../lib/format';
import { Chart } from '../../ui/chart/Chart';
import { barStyle, baseOption, categoryAxis, useChartTheme, valueAxis, type ChartTheme } from '../../ui/chart/theme';
import { Panel, Section } from '../../ui/Page';
import { tipHtml } from './tip';

/** "0–2", "5–10", "200+" with edges converted to the display unit. */
export function binLabels(f: Formatter, edges: readonly number[]): string[] {
  const edge = (km: number) => {
    const v = f.distanceValue(km);
    return f.number(v, v < 10 && !Number.isInteger(v) ? 1 : 0);
  };
  return edges.slice(0, -1).map((from, i) => (Number.isFinite(edges[i + 1]) ? `${edge(from)}–${edge(edges[i + 1])}` : `${edge(from)}+`));
}

export function LengthSection({ trips }: { trips: readonly Trip[] }) {
  const { t } = useTranslation('driving');
  const f = useFormat();
  const theme = useChartTheme();
  const bins = useMemo(() => lengthBins(trips), [trips]);
  const labels = useMemo(() => binLabels(f, LENGTH_EDGES_KM), [f]);
  const totalTrips = trips.length;
  const totalKm = useMemo(() => trips.reduce((s, x) => s + x.distanceKm, 0), [trips]);

  const option = (kind: 'count' | 'distance') => {
    const values = bins.map((b) => (kind === 'count' ? b.trips : totalKm > 0 ? (b.distanceKm / totalKm) * 100 : 0));
    return {
      ...baseOption(theme),
      tooltip: {
        ...baseOption(theme).tooltip,
        formatter: (params: { dataIndex: number }[]) => {
          const i = params[0].dataIndex;
          const b = bins[i];
          const tripShare = totalTrips > 0 ? (b.trips / totalTrips) * 100 : 0;
          const distShare = totalKm > 0 ? (b.distanceKm / totalKm) * 100 : 0;
          return tipHtml(theme, `${labels[i]} ${f.distanceUnit}`, [
            [t('when.count'), `${f.number(b.trips)} (${f.percent(tripShare, 1)})`],
            [t('when.distance'), `${f.distance(b.distanceKm)} (${f.percent(distShare, 1)})`],
          ]);
        },
      },
      xAxis: categoryAxis(theme, labels, { axisLabel: { color: theme.muted, fontSize: 11, interval: 0, hideOverlap: true }, name: t('lengthLabel', { unit: f.distanceUnit }), nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: theme.muted, fontSize: 11 } }),
      yAxis: valueAxis(theme, { name: kind === 'count' ? t('length.tripsAxis') : t('length.shareAxis') }),
      grid: { left: 8, right: 16, top: 30, bottom: 28, containLabel: true },
      series: [
        {
          type: 'bar',
          name: kind === 'count' ? t('when.count') : t('length.distanceChart'),
          data: values.map((v) => Math.round(v * 10) / 10),
          itemStyle: barStyle(kind === 'count' ? theme.series[0] : theme.series[1]),
          barMaxWidth: 26,
        },
      ],
    };
  };

  const countOption = useMemo(() => option('count'), [theme, bins, labels, f, t, totalKm, totalTrips]); // eslint-disable-line react-hooks/exhaustive-deps
  const distanceOption = useMemo(() => option('distance'), [theme, bins, labels, f, t, totalKm, totalTrips]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Section title={t('length.title')} note={t('length.note')}>
      <div className="grid grid-2">
        <Panel title={t('length.countChart')}>
          <Chart option={countOption} ariaLabel={t('length.countChart')} height={260} />
        </Panel>
        <Panel title={t('length.distanceChart')}>
          <Chart option={distanceOption} ariaLabel={t('length.distanceChart')} height={260} />
        </Panel>
      </div>
    </Section>
  );
}

/** Bars with energy-weighted consumption and interquartile whiskers. */
function consumptionOption(theme: ChartTheme, f: Formatter, t: (k: string, o?: Record<string, unknown>) => string, bins: TripBin[], labels: string[], xName: string) {
  const conv = (v: number | null) => (v == null ? null : Math.round(f.consumptionValue(v) * 10) / 10);
  const whiskerStyle = { stroke: theme.ink2, lineWidth: 1.5 };
  return {
    ...baseOption(theme),
    grid: { left: 8, right: 16, top: 30, bottom: 28, containLabel: true },
    tooltip: {
      ...baseOption(theme).tooltip,
      formatter: (params: { dataIndex: number }[]) => {
        if (!params.length) return '';
        const i = params[0].dataIndex;
        const b = bins[i];
        const title = `${labels[i]} ${xName}`;
        if (b.consumption == null) return tipHtml(theme, title, [[t('efficiency.tooFew'), t('efficiency.samples', { count: b.samples })]]);
        return tipHtml(theme, title, [
          [t('efficiency.weighted'), f.consumption(b.consumption)],
          [t('efficiency.medianTrip'), f.consumption(b.median!)],
          [t('efficiency.middleHalf'), `${f.number(f.consumptionValue(b.q1!), 1)}–${f.number(f.consumptionValue(b.q3!), 1)}`],
          [t('efficiency.sampleSize'), f.number(b.samples)],
        ]);
      },
    },
    xAxis: categoryAxis(theme, labels, { axisLabel: { color: theme.muted, fontSize: 11, interval: 0, hideOverlap: true }, name: xName, nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: theme.muted, fontSize: 11 } }),
    yAxis: valueAxis(theme, { name: f.consumptionUnit }),
    series: [
      {
        type: 'bar',
        name: t('efficiency.weighted'),
        data: bins.map((b) => conv(b.consumption)),
        itemStyle: barStyle(theme.series[0]),
        barMaxWidth: 26,
      },
      {
        type: 'custom',
        name: t('efficiency.middleHalf'),
        z: 5,
        silent: true,
        tooltip: { show: false },
        encode: { x: 0, y: [1, 2] },
        data: bins.flatMap((b, i) => (b.q1 == null ? [] : [[i, conv(b.q1), conv(b.q3)]])),
        renderItem: (_: unknown, api: { value: (i: number) => number; coord: (p: number[]) => number[] }) => {
          const i = api.value(0);
          const low = api.coord([i, api.value(1)]);
          const high = api.coord([i, api.value(2)]);
          const cap = 5;
          return {
            type: 'group',
            children: [
              { type: 'line', shape: { x1: low[0], y1: high[1], x2: low[0], y2: low[1] }, style: whiskerStyle },
              { type: 'line', shape: { x1: high[0] - cap, y1: high[1], x2: high[0] + cap, y2: high[1] }, style: whiskerStyle },
              { type: 'line', shape: { x1: low[0] - cap, y1: low[1], x2: low[0] + cap, y2: low[1] }, style: whiskerStyle },
            ],
          };
        },
      },
    ],
  };
}

export function EfficiencySection({ trips }: { trips: readonly Trip[] }) {
  const { t } = useTranslation('driving');
  const f = useFormat();
  const theme = useChartTheme();
  const byLength = useMemo(() => lengthBins(trips), [trips]);
  const bySpeed = useMemo(() => speedBins(trips), [trips]);
  const months = useMemo(() => consumptionByMonthOfYear(trips), [trips]);

  const lengthOption = useMemo(
    () => consumptionOption(theme, f, t, byLength, binLabels(f, LENGTH_EDGES_KM), t('lengthLabel', { unit: f.distanceUnit })),
    [theme, f, t, byLength],
  );
  const speedOption = useMemo(
    () => consumptionOption(theme, f, t, bySpeed, binLabels(f, SPEED_EDGES_KMH), t('speedLabel', { unit: f.unit === 'mi' ? 'mph' : 'km/h' })),
    [theme, f, t, bySpeed],
  );

  const monthOption = useMemo(() => {
    const names = Array.from({ length: 12 }, (_, m) => new Intl.DateTimeFormat(f.locale, { month: 'short' }).format(new Date(2024, m, 1)));
    const longNames = Array.from({ length: 12 }, (_, m) => new Intl.DateTimeFormat(f.locale, { month: 'long' }).format(new Date(2024, m, 1)));
    return {
      ...baseOption(theme),
      tooltip: {
        ...baseOption(theme).tooltip,
        formatter: (params: { dataIndex: number }[]) => {
          if (!params.length) return '';
          const m = months[params[0].dataIndex];
          return tipHtml(theme, longNames[m.month], [
            [t('efficiency.weighted'), m.consumption == null ? t('efficiency.tooFew') : f.consumption(m.consumption)],
            [t('efficiency.sampleSize'), f.number(m.samples)],
          ]);
        },
      },
      xAxis: categoryAxis(theme, names),
      yAxis: valueAxis(theme, { name: f.consumptionUnit }),
      series: [
        {
          type: 'bar',
          name: t('efficiency.weighted'),
          data: months.map((m) => (m.consumption == null ? null : Math.round(f.consumptionValue(m.consumption) * 10) / 10)),
          itemStyle: barStyle(theme.series[0]),
          barMaxWidth: 22,
        },
      ],
    };
  }, [theme, f, t, months]);

  return (
    <Section title={t('efficiency.title')} note={t('efficiency.note')}>
      <div className="grid grid-2">
        <Panel title={t('efficiency.byLength')}>
          <Chart option={lengthOption} ariaLabel={t('efficiency.byLength')} height={270} />
          <p className="dc-caption">{t('efficiency.legend')}</p>
        </Panel>
        <Panel title={t('efficiency.bySpeed')}>
          <Chart option={speedOption} ariaLabel={t('efficiency.bySpeed')} height={270} />
          <p className="dc-caption">{t('efficiency.legend')}</p>
        </Panel>
      </div>
      <div style={{ marginTop: 16 }}>
        <Panel title={t('efficiency.byMonth')}>
          <Chart option={monthOption} ariaLabel={t('efficiency.byMonth')} height={250} />
          <p className="dc-caption">{t('efficiency.monthNote')}</p>
        </Panel>
      </div>
      <p className="dc-caption">
        {t('efficiency.shortTripsNote')} {t('efficiency.hiddenNote', { count: MIN_BIN_SAMPLES })}
      </p>
    </Section>
  );
}
