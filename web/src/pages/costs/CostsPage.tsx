import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  blendedPrice,
  categoryCosts,
  costSummary,
  FUEL_CO2_KG_PER_LITRE,
  MIN_MONTH_KM,
  monthlyCosts,
  type CostAssumptions,
} from '../../analytics/costs';
import { totals } from '../../analytics/core';
import { useFormat } from '../../lib/format';
import { href } from '../../lib/router';
import { updateSettings, useSettings, type Settings } from '../../lib/settings';
import { useDataset } from '../../store/dataset';
import { Chart } from '../../ui/chart/Chart';
import { barStyle, baseOption, categoryAxis, useChartTheme, valueAxis } from '../../ui/chart/theme';
import { EmptyState } from '../../ui/EmptyState';
import { Page, Panel, Section } from '../../ui/Page';
import { Stat } from '../../ui/Stat';
import { tipHtml } from '../driving/tip';
import '../driving/driving.css';
import './costs.css';

const VISIBLE_MONTHS = 12;

function PriceInput({ label, value, unit, onChange }: { label: string; value: number; unit: string; onChange: (value: number) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <span className="input-inline">
        <input
          id={id}
          className="input num"
          type="number"
          inputMode="decimal"
          min={0}
          step={0.01}
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            if (Number.isFinite(v) && v >= 0) onChange(v);
          }}
        />
        <span className="muted">{unit}</span>
      </span>
    </div>
  );
}

export default function CostsPage() {
  const { t } = useTranslation('costs');
  const f = useFormat();
  const theme = useChartTheme();
  const settings = useSettings();
  const { trips, loading } = useDataset();
  const [showAll, setShowAll] = useState(false);

  const { homePrice, publicPrice, homeShare, fuelPrice, fuelConsumption, chargingLossPercent, gridCo2, currency } = settings;
  const assumptions = useMemo<CostAssumptions>(
    () => ({ homePrice, publicPrice, homeShare, fuelPrice, fuelConsumption, chargingLossPercent, gridCo2 }),
    [homePrice, publicPrice, homeShare, fuelPrice, fuelConsumption, chargingLossPercent, gridCo2],
  );
  const span = useMemo(() => totals(trips).spanDays, [trips]);
  const summary = useMemo(() => costSummary(trips, assumptions, span), [trips, assumptions, span]);
  const months = useMemo(() => monthlyCosts(trips, assumptions), [trips, assumptions]);
  const categories = useMemo(() => categoryCosts(trips, assumptions), [trips, assumptions]);

  const monthLabels = useMemo(() => months.map((m) => f.month(m.key)), [months, f]);
  const money = (v: number) => f.currency(v, 2);
  const per100 = (v: number) => f.currency(f.consumptionValue(v), 2);

  const monthlyOption = useMemo(
    () => ({
      ...baseOption(theme),
      grid: { left: 8, right: 16, top: 44, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: theme.ink2, fontSize: 12 } },
      tooltip: {
        ...baseOption(theme).tooltip,
        formatter: (params: { dataIndex: number }[]) => {
          const m = months[params[0].dataIndex];
          return tipHtml(theme, monthLabels[params[0].dataIndex], [
            [t('charts.electric'), money(m.electricCost)],
            [t('charts.petrol'), money(m.fuelCost)],
            [t('charts.savings'), money(m.savings)],
            [t('charts.trips'), f.number(m.trips)],
          ]);
        },
      },
      xAxis: categoryAxis(theme, monthLabels),
      yAxis: valueAxis(theme, { name: currency }),
      series: [
        { type: 'bar', name: t('charts.electric'), data: months.map((m) => Math.round(m.electricCost * 100) / 100), itemStyle: barStyle(theme.series[0]), barMaxWidth: 14 },
        { type: 'bar', name: t('charts.petrol'), data: months.map((m) => Math.round(m.fuelCost * 100) / 100), itemStyle: barStyle(theme.series[1]), barMaxWidth: 14 },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, months, monthLabels, currency, f, t],
  );

  const cumulativeOption = useMemo(
    () => ({
      ...baseOption(theme),
      tooltip: {
        ...baseOption(theme).tooltip,
        formatter: (params: { dataIndex: number }[]) => {
          const m = months[params[0].dataIndex];
          return tipHtml(theme, monthLabels[params[0].dataIndex], [
            [t('charts.cumulative'), money(m.cumulativeSavings)],
            [t('charts.savings'), money(m.savings)],
          ]);
        },
      },
      xAxis: categoryAxis(theme, monthLabels, { boundaryGap: false }),
      yAxis: valueAxis(theme, { name: currency }),
      series: [
        {
          type: 'line',
          name: t('charts.cumulative'),
          data: months.map((m) => Math.round(m.cumulativeSavings * 100) / 100),
          lineStyle: { width: 2, color: theme.series[0] },
          itemStyle: { color: theme.series[0], borderColor: theme.surface, borderWidth: 2 },
          symbolSize: 8,
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, months, monthLabels, currency, f, t],
  );

  const per100Option = useMemo(() => {
    const fuel = summary.fuelCostPer100Km;
    return {
      ...baseOption(theme),
      grid: { left: 8, right: 16, top: 44, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: theme.ink2, fontSize: 12 } },
      tooltip: {
        ...baseOption(theme).tooltip,
        formatter: (params: { dataIndex: number }[]) => {
          const m = months[params[0].dataIndex];
          return tipHtml(theme, monthLabels[params[0].dataIndex], [
            [t('charts.electric'), m.reliableCostPer100Km == null ? '–' : per100(m.reliableCostPer100Km)],
            [t('charts.petrol'), fuel == null ? '–' : per100(fuel)],
            [t('charts.distance'), f.distance(m.distanceKm)],
          ]);
        },
      },
      xAxis: categoryAxis(theme, monthLabels, { boundaryGap: false }),
      yAxis: valueAxis(theme, { name: `${currency}/100 ${f.distanceUnit}`, min: 0 }),
      series: [
        {
          type: 'line',
          name: t('charts.electric'),
          data: months.map((m) => (m.reliableCostPer100Km == null ? null : Math.round(f.consumptionValue(m.reliableCostPer100Km) * 100) / 100)),
          lineStyle: { width: 2, color: theme.series[0] },
          itemStyle: { color: theme.series[0], borderColor: theme.surface, borderWidth: 2 },
          symbolSize: 8,
          connectNulls: true,
        },
        {
          type: 'line',
          name: t('charts.petrol'),
          data: months.map(() => (fuel == null ? null : Math.round(f.consumptionValue(fuel) * 100) / 100)),
          lineStyle: { width: 2, color: theme.series[1], type: 'dashed' },
          itemStyle: { color: theme.series[1] },
          showSymbol: false,
        },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, months, monthLabels, summary.fuelCostPer100Km, currency, f, t]);

  if (loading) return null;
  if (trips.length === 0) {
    return (
      <Page overline={t('overline')} title={t('title')} lead={t('lead')}>
        <EmptyState />
      </Page>
    );
  }

  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const savingsHint =
    summary.savingsShare == null
      ? undefined
      : t(summary.savings >= 0 ? 'stats.savingsHint' : 'stats.savingsHintNegative', { share: f.percent(Math.abs(summary.savingsShare) * 100) });
  const categoryName = (c: string) => (c ? t(`categories.${c}`, { defaultValue: c }) : t('categories.empty'));
  const monthRows = showAll ? [...months].reverse() : [...months].reverse().slice(0, VISIBLE_MONTHS);
  const unitLabel = f.distanceUnit;

  return (
    <Page overline={t('overline')} title={t('title')} lead={t('lead')}>
      <div className="stats dc-stats">
        <Stat label={t('stats.total')} value={f.currency(summary.electricCost, 0)} hint={t('stats.totalHint', { kwh: f.energy(summary.gridKwh, 0) })} accent />
        <Stat label={t('stats.per100', { unit: unitLabel })} value={summary.costPer100Km == null ? '–' : per100(summary.costPer100Km)} hint={summary.fuelCostPer100Km == null ? undefined : `${t('charts.petrol')}: ${per100(summary.fuelCostPer100Km)}`} />
        <Stat label={t('stats.perMonth')} value={summary.costPerMonth == null ? '–' : f.currency(summary.costPerMonth, 0)} hint={t('stats.perMonthHint')} />
        <Stat label={t('stats.perTrip')} value={summary.costPerTrip == null ? '–' : money(summary.costPerTrip)} />
        <Stat label={t('stats.fuel')} value={f.currency(summary.fuelCost, 0)} hint={t('stats.fuelHint', { litres: `${f.number(summary.fuelLitres, 0)} l`, price: f.currency(fuelPrice) })} />
        <Stat label={t('stats.savings')} value={f.currency(summary.savings, 0)} hint={savingsHint} />
        <Stat label={t('stats.co2Electric')} value={f.number(summary.co2ElectricKg, 0)} unit="kg" hint={t('stats.co2ElectricHint', { intensity: f.number(gridCo2) })} />
        <Stat label={t('stats.co2Petrol')} value={f.number(summary.co2PetrolKg, 0)} unit="kg" hint={t('stats.co2PetrolHint', { saved: f.number(summary.co2SavedKg, 0) })} />
      </div>
      <p className="dc-caption">{t('estimateNote')}</p>

      <Section title={t('assumptions.title')} note={t('assumptions.note')}>
        <Panel>
          <div className="dc-assume">
            <div className="dc-assume-inputs">
              <PriceInput label={t('assumptions.home')} value={homePrice} unit={t('assumptions.perKwh', { currency })} onChange={(v) => set({ homePrice: v })} />
              <PriceInput label={t('assumptions.public')} value={publicPrice} unit={t('assumptions.perKwh', { currency })} onChange={(v) => set({ publicPrice: v })} />
              <PriceInput label={t('assumptions.fuel')} value={fuelPrice} unit={t('assumptions.perLitre', { currency })} onChange={(v) => set({ fuelPrice: v })} />
            </div>
            <div className="dc-assume-derived">
              <span>
                {t('assumptions.derived', {
                  share: f.percent(homeShare * 100),
                  price: f.currency(blendedPrice(assumptions), 3),
                  loss: f.percent(chargingLossPercent),
                  co2: f.number(gridCo2),
                  consumption: f.number(fuelConsumption, 1),
                })}
              </span>
              <a href={href('settings')}>{t('assumptions.moreInSettings')} →</a>
            </div>
            <p className="dc-caption" style={{ margin: 0 }}>
              {t('assumptions.coverage', { count: summary.trips, distance: f.distance(summary.distanceKm) })} {t('assumptions.co2Note', { factor: f.number(FUEL_CO2_KG_PER_LITRE, 2) })}
            </p>
          </div>
        </Panel>
      </Section>

      <Section title={t('charts.monthly')}>
        <Panel title={t('charts.monthly')}>
          <Chart option={monthlyOption} ariaLabel={t('charts.monthly')} height={290} />
        </Panel>
        <div className="grid grid-2" style={{ marginTop: 16 }}>
          <Panel title={t('charts.cumulative')}>
            <Chart option={cumulativeOption} ariaLabel={t('charts.cumulative')} height={250} />
            <p className="dc-caption">{t('charts.cumulativeNote')}</p>
          </Panel>
          <Panel title={t('charts.per100', { unit: unitLabel })}>
            <Chart option={per100Option} ariaLabel={t('charts.per100', { unit: unitLabel })} height={250} />
            <p className="dc-caption">{t('charts.per100Note', { distance: f.distance(MIN_MONTH_KM) })}</p>
          </Panel>
        </div>
      </Section>

      <Section title={t('table.monthly')}>
        <div className="panel panel-flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('table.month')}</th>
                  <th className="num">{t('table.trips')}</th>
                  <th className="num">{t('table.distance')}</th>
                  <th className="num">{t('table.battery')}</th>
                  <th className="num">{t('table.cost')}</th>
                  <th className="num">{t('table.fuel')}</th>
                  <th className="num">{t('table.savings')}</th>
                </tr>
              </thead>
              <tbody>
                {monthRows.map((m) => (
                  <tr key={m.key}>
                    <td>{f.month(m.key)}</td>
                    <td className="num">{f.number(m.trips)}</td>
                    <td className="num">{f.distance(m.distanceKm)}</td>
                    <td className="num">{f.energy(m.batteryKwh, 0)}</td>
                    <td className="num">{money(m.electricCost)}</td>
                    <td className="num">{money(m.fuelCost)}</td>
                    <td className="num">{money(m.savings)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="dc-foot">
                <tr>
                  <td>{t('table.total')}</td>
                  <td className="num">{f.number(summary.trips)}</td>
                  <td className="num">{f.distance(summary.distanceKm)}</td>
                  <td className="num">{f.energy(summary.batteryKwh, 0)}</td>
                  <td className="num">{money(summary.electricCost)}</td>
                  <td className="num">{money(summary.fuelCost)}</td>
                  <td className="num">{money(summary.savings)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {months.length > VISIBLE_MONTHS && (
            <div className="dc-more">
              <button type="button" className="button button-secondary button-small" onClick={() => setShowAll((v) => !v)}>
                {showAll ? t('table.showLess') : t('table.showAll', { count: months.length })}
              </button>
            </div>
          )}
        </div>
      </Section>

      <Section title={t('categories.title')} note={t('categories.note')}>
        <div className="panel panel-flush table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('categories.category')}</th>
                <th className="num">{t('table.trips')}</th>
                <th className="num">{t('table.distance')}</th>
                <th className="num">{t('table.battery')}</th>
                <th className="num">{t('table.grid')}</th>
                <th className="num">{t('table.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.category}>
                  <td>{categoryName(c.category)}</td>
                  <td className="num">{f.number(c.allTrips)}</td>
                  <td className="num">{f.distance(c.allDistanceKm)}</td>
                  <td className="num">{f.energy(c.batteryKwh, 1)}</td>
                  <td className="num">{f.energy(c.gridKwh, 1)}</td>
                  <td className="num">{money(c.electricCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </Page>
  );
}
