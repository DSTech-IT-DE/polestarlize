import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { dailyTotals, rampClasses, weekdayHourGrid } from '../../analytics/driving';
import type { Trip } from '../../domain/trip';
import { useFormat } from '../../lib/format';
import { Chart } from '../../ui/chart/Chart';
import { baseOption, categoryAxis, useChartTheme, type ChartTheme } from '../../ui/chart/theme';
import { Panel, Section } from '../../ui/Page';
import { Segmented } from '../../ui/Segmented';
import { tipHtml } from './tip';

type Metric = 'count' | 'distance';

/**
 * ECharts heatmaps insist on a visualMap. The class (0 = empty, 1..5 = quantile step) travels as
 * an extra data dimension, so the colours follow `rampClasses` and the map itself stays hidden.
 */
function rampMap(theme: ChartTheme, dimension: number) {
  return {
    type: 'piecewise' as const,
    show: false,
    dimension,
    pieces: [0, 1, 2, 3, 4, 5].map((cls) => ({ value: cls, color: cls === 0 ? theme.bg : theme.sequential[cls] })),
  };
}

/** "less [five steps] more" legend for the sequential ramp. */
function Ramp({ theme, low, high }: { theme: ChartTheme; low: string; high: string }) {
  return (
    <div className="dc-ramp" aria-hidden="true">
      <span>{low}</span>
      <span className="dc-ramp-steps">
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} style={{ '--swatch': theme.sequential[i] } as CSSProperties} />
        ))}
      </span>
      <span>{high}</span>
    </div>
  );
}

export function WhenSection({ trips }: { trips: readonly Trip[] }) {
  const { t } = useTranslation('driving');
  const f = useFormat();
  const theme = useChartTheme();
  const [metric, setMetric] = useState<Metric>('count');

  const grid = useMemo(() => weekdayHourGrid(trips), [trips]);
  const days = useMemo(() => dailyTotals(trips), [trips]);
  const weekdays = useMemo(() => f.weekdayNames('short'), [f]);
  const weekdaysLong = useMemo(() => f.weekdayNames('long'), [f]);

  const cells = useMemo(() => {
    const source = metric === 'count' ? grid.count : grid.distanceKm;
    const values = source.flat();
    const cls = rampClasses(values);
    const max = Math.max(0, ...values);
    const data = source.flatMap((row, weekday) =>
      row.map((value, hour) => [hour, weekday, value, cls(value)]),
    );
    return { data, max };
  }, [grid, metric, theme]);

  const fmt = (value: number) => (metric === 'count' ? t('tripsCount', { count: value }) : f.distance(value));

  const heatmapOption = useMemo(
    () => ({
      ...baseOption(theme),
      grid: { left: 8, right: 8, top: 8, bottom: 40, containLabel: true },
      tooltip: {
        ...baseOption(theme).tooltip,
        trigger: 'item' as const,
        formatter: (p: { value: number[] }) => {
          const [hour, weekday, value] = p.value;
          const hh = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;
          return tipHtml(theme, `${weekdaysLong[weekday]}, ${hh(hour)}–${hh(hour + 1)}`, [[t(metric === 'count' ? 'when.count' : 'when.distance'), fmt(value)]]);
        },
      },
      xAxis: {
        ...categoryAxis(theme, Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')), { axisLabel: { color: theme.muted, fontSize: 11, interval: 2 } }),
        name: t('when.startHour'),
        nameLocation: 'middle',
        nameGap: 26,
        nameTextStyle: { color: theme.muted, fontSize: 11 },
        axisLine: { show: false },
      },
      yAxis: { ...categoryAxis(theme, weekdays, { inverse: true }), axisLine: { show: false } },
      visualMap: rampMap(theme, 3),
      series: [
        {
          type: 'heatmap',
          data: cells.data,
          itemStyle: { borderColor: theme.surface, borderWidth: 2, borderRadius: 2 },
          emphasis: { itemStyle: { borderColor: theme.ink, borderWidth: 1 } },
          animation: false,
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, cells, weekdays, weekdaysLong, metric, f, t],
  );

  const years = useMemo(() => [...new Set(days.map((d) => d.date.slice(0, 4)))], [days]);
  const calendarHeight = 44 + years.length * 140;
  const calendarOption = useMemo(() => {
    const cls = rampClasses(days.map((d) => d.distanceKm));
    const months = Array.from({ length: 12 }, (_, m) => new Intl.DateTimeFormat(f.locale, { month: 'short' }).format(new Date(2024, m, 1)));
    // ECharts expects the day names starting with Sunday.
    const dayNames = [weekdays[6], ...weekdays.slice(0, 6)];
    return {
      ...baseOption(theme),
      tooltip: {
        ...baseOption(theme).tooltip,
        trigger: 'item' as const,
        formatter: (p: { value: [string, number, number] }) => {
          const [date, km, count] = p.value;
          return tipHtml(theme, f.date(`${date}T00:00`, { dateStyle: 'full' }), [
            [t('when.distance'), f.distance(km)],
            [t('when.count'), t('when.tripsOnDay', { count })],
          ]);
        },
      },
      calendar: years.map((year, i) => ({
        top: 44 + i * 140,
        left: 34,
        right: 6,
        cellSize: ['auto', 16],
        range: year,
        itemStyle: { color: theme.bg, borderColor: theme.surface, borderWidth: 2 },
        splitLine: { show: false },
        yearLabel: { show: true, position: 'top', margin: 36, color: theme.ink, fontFamily: theme.fontMono, fontSize: 12 },
        dayLabel: { firstDay: 1, nameMap: dayNames, color: theme.muted, fontSize: 10, margin: 6 },
        monthLabel: { nameMap: months, color: theme.muted, fontSize: 10, margin: 6 },
      })),
      visualMap: rampMap(theme, 3),
      series: years.map((year, i) => ({
        type: 'heatmap',
        coordinateSystem: 'calendar',
        calendarIndex: i,
        data: days
          .filter((d) => d.date.startsWith(year))
          .map((d) => [d.date, d.distanceKm, d.trips, cls(d.distanceKm)]),
        emphasis: { itemStyle: { borderColor: theme.ink, borderWidth: 1 } },
        animation: false,
      })),
    };
  }, [theme, days, years, weekdays, f, t]);

  const dayMax = Math.max(0, ...days.map((d) => d.distanceKm));

  return (
    <Section title={t('when.title')}>
      <div className="grid">
        <Panel title={t('when.heatmap')}>
          <div className="dc-toolbar">
            <span>{t('when.heatmapNote')}</span>
            <Segmented
              label={t('when.metric')}
              value={metric}
              options={[
                { value: 'count', label: t('when.count') },
                { value: 'distance', label: t('when.distance') },
              ]}
              onChange={setMetric}
            />
          </div>
          <Chart option={heatmapOption} ariaLabel={t('when.heatmap')} height={280} />
          <Ramp theme={theme} low={t('when.less')} high={`${t('when.more')} (${fmt(cells.max)})`} />
        </Panel>
        <Panel title={t('when.calendar')}>
          <p className="dc-caption" style={{ marginTop: 0, marginBottom: 10 }}>
            {t('when.calendarNote')}
          </p>
          <div className="dc-scroll">
            <div>
              <Chart option={calendarOption} ariaLabel={t('when.calendar')} height={calendarHeight} />
            </div>
          </div>
          <Ramp theme={theme} low={t('when.less')} high={`${t('when.more')} (${f.distance(dayMax)})`} />
        </Panel>
      </div>
    </Section>
  );
}
