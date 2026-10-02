import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { analyzePlaces } from '../../analytics/places';
import {
  EMPTY_FILTER,
  filterTrips,
  sortTrips,
  summarizeTrips,
  type SortDirection,
  type TripFilter,
  type TripSortKey,
  type TripStatusFilter,
} from '../../analytics/tripsFilter';
import type { TripCheck } from '../../analytics/plausibility';
import { consumptionPer100, durationMinutes, KM_PER_MILE, type Trip } from '../../domain/trip';
import { toJourneyLogCsv } from '../../import/exportCsv';
import { shortAddress } from '../../lib/address';
import { useFormat } from '../../lib/format';
import { href, useRoute } from '../../lib/router';
import { useSettings } from '../../lib/settings';
import { useDataset } from '../../store/dataset';
import { useChartTheme } from '../../ui/chart/theme';
import { EmptyState } from '../../ui/EmptyState';
import { Page, Section } from '../../ui/Page';
import { ReviewNotice } from '../../ui/ReviewNotice';
import { Stat, Stats } from '../../ui/Stat';
import { TripDetails } from './TripDetails';
import './trips.css';

const PAGE_SIZE = 50;
const KNOWN_CATEGORIES: Record<string, string> = { Private: 'private', Business: 'business', Uncategorized: 'uncategorized' };
const STATUS_FILTERS: TripStatusFilter[] = ['review', 'excluded', 'flagged'];

function filterFromParams(params: URLSearchParams): TripFilter {
  return {
    ...EMPTY_FILTER,
    query: params.get('q') ?? '',
    placeId: params.get('place') ?? '',
    category: params.get('category') ?? '',
    tripType: params.get('type') === 'MERGED' || params.get('type') === 'SINGLE' ? (params.get('type') as string) : '',
    status: STATUS_FILTERS.find((s) => s === params.get('status')) ?? '',
  };
}

function download(filename: string, text: string) {
  // BOM so Excel reads the umlauts of the addresses correctly.
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function TripsPage() {
  const { t } = useTranslation('trips');
  const f = useFormat();
  const theme = useChartTheme();
  const { distanceUnit } = useSettings();
  // The list shows every recording, also the ones left out of the analyses.
  const { recordedTrips: trips, checks, loading } = useDataset();
  const { params } = useRoute();
  const paramsKey = params.toString();

  const [filter, setFilter] = useState<TripFilter>(() => filterFromParams(params));
  const [minInput, setMinInput] = useState('');
  const [sort, setSort] = useState<{ key: TripSortKey; direction: SortDirection }>({ key: 'start', direction: 'desc' });
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  // Links from other pages (map popups, …) change the hash while this page stays mounted.
  useEffect(() => {
    setFilter(filterFromParams(new URLSearchParams(paramsKey)));
    setMinInput('');
    setPage(0);
  }, [paramsKey]);

  const minKm = useMemo(() => {
    const value = Number(minInput.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) return 0;
    return distanceUnit === 'mi' ? value * KM_PER_MILE : value;
  }, [minInput, distanceUnit]);
  const effective = useMemo(() => ({ ...filter, minKm }), [filter, minKm]);

  // Place ids only exist after clustering, so this is only computed for place links.
  const places = useMemo(() => (filter.placeId ? analyzePlaces(trips) : null), [filter.placeId, trips]);
  const place = filter.placeId ? places?.byId.get(filter.placeId) : undefined;

  const categories = useMemo(() => [...new Set(trips.map((trip) => trip.category))].sort(), [trips]);
  const filtered = useMemo(() => filterTrips(trips, effective, places?.assignments, checks), [trips, effective, places, checks]);
  const sorted = useMemo(() => sortTrips(filtered, sort.key, sort.direction), [filtered, sort]);
  const counted = useMemo(() => filtered.filter((trip) => checks.get(trip.id)?.status === 'ok'), [filtered, checks]);
  // Totals follow the analyses, unless the user filters for held-back trips on purpose.
  const summary = useMemo(() => summarizeTrips(filter.status ? filtered : counted), [filter.status, filtered, counted]);
  const notCounted = filtered.length - counted.length;

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const rows = sorted.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const categoryLabel = (category: string) => {
    const key = KNOWN_CATEGORIES[category];
    return key ? t(`category.${key}`) : category || t('category.none');
  };

  const update = (patch: Partial<TripFilter>) => {
    setFilter((prev) => ({ ...prev, ...patch }));
    setPage(0);
  };
  const changeSort = (key: TripSortKey) => {
    setSort((prev) => (prev.key === key ? { key, direction: prev.direction === 'desc' ? 'asc' : 'desc' } : { key, direction: 'desc' }));
    setPage(0);
  };
  const isFiltered = filtered.length !== trips.length || filter.placeId !== '' || filter.status !== '';
  const reset = () => {
    setFilter(EMPTY_FILTER);
    setMinInput('');
    setPage(0);
    if (params.size > 0) location.hash = href('trips');
  };

  const exportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    download(`polestarlize-trips-${stamp}.csv`, toJourneyLogCsv(filtered));
  };

  if (loading) return null;
  if (trips.length === 0) {
    return (
      <Page overline={t('overline')} title={t('title')} lead={t('lead')}>
        <EmptyState />
      </Page>
    );
  }

  const splitColours = [theme.series[0], theme.series[1], theme.series[2]];
  // Three categories get their own colour, the rest is folded into "other".
  const split = summary.categories.slice(0, 3).map((c, i) => ({ ...c, colour: splitColours[i], label: categoryLabel(c.category) }));
  const rest = summary.categories.slice(3);
  if (rest.length > 0) {
    split.push({
      category: '',
      trips: rest.reduce((s, c) => s + c.trips, 0),
      distanceKm: rest.reduce((s, c) => s + c.distanceKm, 0),
      colour: theme.muted,
      label: t('category.other'),
    });
  }

  const header = (key: TripSortKey, label: string, className = '', unit?: string) => {
    const active = sort.key === key;
    return (
      <th className={className} aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className="th-sort" onClick={() => changeSort(key)}>
          {label}
          {unit && <span className="th-unit">{unit}</span>}
          <span aria-hidden="true" className="th-sort-arrow">
            {active ? (sort.direction === 'asc' ? '↑' : '↓') : ''}
          </span>
        </button>
      </th>
    );
  };

  return (
    <Page
      overline={t('overline')}
      title={t('title')}
      lead={t('lead')}
      actions={
        <button type="button" className="button button-secondary" onClick={exportCsv} disabled={filtered.length === 0}>
          {t('export', { count: filtered.length })}
        </button>
      }
    >
      <ReviewNotice showLink={filter.status !== 'review'} />

      <div className="trip-filters">
        <Field label={t('filter.search')} grow>
          <input
            className="input"
            type="search"
            value={filter.query}
            placeholder={t('filter.searchPlaceholder')}
            onChange={(e) => update({ query: e.target.value })}
          />
        </Field>
        <Field label={t('filter.category')}>
          <select className="select" value={filter.category} onChange={(e) => update({ category: e.target.value })}>
            <option value="">{t('filter.all')}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('filter.type')}>
          <select className="select" value={filter.tripType} onChange={(e) => update({ tripType: e.target.value })}>
            <option value="">{t('filter.all')}</option>
            <option value="SINGLE">{t('type.single')}</option>
            <option value="MERGED">{t('type.merged')}</option>
          </select>
        </Field>
        <Field label={t('filter.status')}>
          <select className="select" value={filter.status} onChange={(e) => update({ status: e.target.value as TripStatusFilter })}>
            <option value="">{t('filter.all')}</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {t(`filter.statusOption.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('filter.minDistance', { unit: distanceUnit })}>
          <input
            className="input trip-filter-min"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={minInput}
            placeholder="0"
            onChange={(e) => {
              setMinInput(e.target.value);
              setPage(0);
            }}
          />
        </Field>
        {(isFiltered || filter.query || minInput) && (
          <button type="button" className="button button-secondary button-small trip-filter-reset" onClick={reset}>
            {t('filter.reset')}
          </button>
        )}
      </div>

      {filter.placeId && (
        <p className="note trip-place-note">{place ? t('filter.place', { place: place.label }) : t('filter.placeUnknown')}</p>
      )}

      <Stats>
        <Stat
          label={t('summary.trips')}
          value={f.number(summary.trips)}
          hint={
            notCounted > 0
              ? t(filter.status ? 'summary.includesNotCounted' : 'summary.withoutNotCounted', { count: notCounted })
              : isFiltered
                ? t('summary.ofAll', { count: trips.length })
                : undefined
          }
          accent
        />
        <Stat label={t('summary.distance')} value={f.number(f.distanceValue(summary.distanceKm))} unit={f.distanceUnit} />
        <Stat label={t('summary.energy')} value={f.number(summary.energyKwh, summary.energyKwh < 10 ? 1 : 0)} unit="kWh" />
        <Stat
          label={t('summary.consumption')}
          value={summary.consumption == null ? '–' : f.number(f.consumptionValue(summary.consumption), 1)}
          unit={f.consumptionUnit}
        />
      </Stats>

      {summary.distanceKm > 0 && (
        <div className="trip-split" role="group" aria-label={t('summary.split')}>
          <div className="trip-split-bar">
            {split.map((c) => (
              <span key={c.label} style={{ flexGrow: c.distanceKm, background: c.colour }} />
            ))}
          </div>
          <ul className="trip-split-legend">
            {split.map((c) => (
              <li key={c.label}>
                <i style={{ background: c.colour }} />
                <span>{c.label}</span>
                <span className="num">{f.distance(c.distanceKm)}</span>
                <span className="muted num">{f.percent((c.distanceKm / summary.distanceKm) * 100)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Section
        title={t('list')}
        aside={
          <span className="section-note num">
            {sorted.length === 0
              ? '0'
              : t('range', { from: current * PAGE_SIZE + 1, to: current * PAGE_SIZE + rows.length, total: f.number(sorted.length) })}
          </span>
        }
      >
        <div className="panel panel-flush table-wrap">
          <table className="table trip-table">
            <thead>
              <tr>
                {header('start', t('col.when'))}
                {header('duration', t('col.duration'), 'num col-secondary')}
                <th>{t('col.route')}</th>
                {header('distance', t('col.distance'), 'num')}
                {header('energy', t('col.energy'), 'num col-secondary')}
                {header('consumption', t('col.consumption'), 'num', f.consumptionUnit)}
                <th className="num col-secondary">{t('col.soc')}</th>
                <th>{t('col.category')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    {t('none')}
                  </td>
                </tr>
              )}
              {rows.map((trip) => (
                <TripRow
                  key={trip.id}
                  trip={trip}
                  check={checks.get(trip.id)}
                  expanded={open === trip.id}
                  onToggle={() => setOpen(open === trip.id ? null : trip.id)}
                  f={f}
                  categoryLabel={categoryLabel(trip.category)}
                />
              ))}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <nav className="trip-pager" aria-label={t('pager.label')}>
            <button
              type="button"
              className="button button-secondary button-small"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              {t('pager.prev')}
            </button>
            <span className="num muted">
              {current + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="button button-secondary button-small"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(current + 1)}
            >
              {t('pager.next')}
            </button>
          </nav>
        )}
      </Section>
    </Page>
  );
}

function Field({ label, grow, children }: { label: string; grow?: boolean; children: ReactNode }) {
  return (
    <label className={grow ? 'field trip-field-grow' : 'field'}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function TripRow({
  trip,
  check,
  expanded,
  onToggle,
  f,
  categoryLabel,
}: {
  trip: Trip;
  check: TripCheck | undefined;
  expanded: boolean;
  onToggle: () => void;
  f: ReturnType<typeof useFormat>;
  categoryLabel: string;
}) {
  const { t } = useTranslation('trips');
  const consumption = consumptionPer100(trip);
  const from = shortAddress(trip.startAddress);
  const to = shortAddress(trip.endAddress);
  const status = check?.status ?? 'ok';
  const rowClass = ['trip-row', expanded && 'is-open', status !== 'ok' && 'is-held-back'].filter(Boolean).join(' ');
  return (
    <>
      <tr className={rowClass} onClick={onToggle}>
        <td className="num trip-when">
          <button
            type="button"
            className="trip-toggle"
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            <span aria-hidden="true">{expanded ? '−' : '+'}</span>
            <span className="visually-hidden">{t('toggle')}</span>
          </button>
          {f.dateTime(trip.start)}
        </td>
        <td className="num col-secondary">{f.duration(durationMinutes(trip))}</td>
        <td className="trip-route-cell" title={`${trip.startAddress} → ${trip.endAddress}`}>
          <span className="trip-route">
            {from} <span className="muted">→</span> {to}
          </span>
          {(trip.tripType === 'MERGED' || trip.comment || status !== 'ok') && (
            <span className="trip-marks">
              {status === 'review' && <span className="tag tag-warning">{t('review.tag.pending')}</span>}
              {status === 'excluded' && <span className="tag">{t('review.tag.excluded')}</span>}
              {trip.tripType === 'MERGED' && <span className="tag">{t('type.mergedShort')}</span>}
              {trip.comment && (
                <span className="tag" title={trip.comment}>
                  {t('commentShort')}
                </span>
              )}
            </span>
          )}
        </td>
        <td className="num">{f.distance(trip.distanceKm, trip.distanceKm < 10 ? 1 : 0)}</td>
        <td className="num col-secondary">{trip.energyKwh == null ? '–' : f.energy(trip.energyKwh, 1)}</td>
        <td className="num">{consumption == null ? '–' : f.number(f.consumptionValue(consumption), 1)}</td>
        <td className="num col-secondary">
          {trip.socStart ?? '–'} → {trip.socEnd ?? '–'} %
        </td>
        <td>
          <span className={trip.category === 'Business' ? 'tag tag-accent' : 'tag'}>{categoryLabel}</span>
        </td>
      </tr>
      {expanded && (
        <tr className="trip-detail-row">
          <td colSpan={8}>
            <TripDetails trip={trip} check={check} f={f} />
          </td>
        </tr>
      )}
    </>
  );
}
