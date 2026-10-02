import { lazy, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { analyzePlaces, type Place, type PlaceAnalysis } from '../../analytics/places';
import { geography } from '../../analytics/placesGeography';
import { frequentRoutes } from '../../analytics/routes';
import type { Trip } from '../../domain/trip';
import { useFormat } from '../../lib/format';
import { href } from '../../lib/router';
import { updateSettings, useSettings } from '../../lib/settings';
import { useDataset } from '../../store/dataset';
import { useChartTheme } from '../../ui/chart/theme';
import { EmptyState } from '../../ui/EmptyState';
import { Page, Section } from '../../ui/Page';
import { Segmented } from '../../ui/Segmented';
import { Stat, Stats } from '../../ui/Stat';
import type { MapData, MapLayers } from './PlacesMap';
import { buildPlacePopup, dwellText } from './popup';
import './map.css';

const PlacesMap = lazy(() => import('./PlacesMap'));

const TOP_PLACES = 12;
const TOP_ROUTES = 12;
const TOP_TOWNS = 12;
const MAX_ALL_PLACES = 300;

function buildMapData(trips: readonly Trip[], analysis: PlaceAnalysis, bounds: MapData['bounds']): MapData {
  const lines: MapData['lines']['features'] = [];
  const endpoints: MapData['endpoints']['features'] = [];
  for (const t of trips) {
    const a = analysis.assignments.get(t.id);
    const hasStart = t.startLat != null && t.startLon != null && (t.startLat !== 0 || t.startLon !== 0);
    const hasEnd = t.endLat != null && t.endLon != null && (t.endLat !== 0 || t.endLon !== 0);
    if (hasStart) endpoints.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [t.startLon!, t.startLat!] } });
    if (hasEnd) endpoints.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [t.endLon!, t.endLat!] } });
    // Loops within one place would only draw a dot.
    if (hasStart && hasEnd && !(a?.from && a.from === a.to)) {
      lines.push({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [t.startLon!, t.startLat!],
            [t.endLon!, t.endLat!],
          ],
        },
      });
    }
  }
  const places: MapData['places'] = {
    type: 'FeatureCollection',
    features: analysis.places.map((p) => ({
      type: 'Feature',
      properties: { id: p.id, label: p.label, visits: p.visits, kind: p.isHome ? 'home' : p.isWork ? 'work' : 'other' },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    })),
  };
  return {
    lines: { type: 'FeatureCollection', features: lines },
    endpoints: { type: 'FeatureCollection', features: endpoints },
    places,
    bounds,
  };
}

export default function MapPage() {
  const { t } = useTranslation('map');
  const f = useFormat();
  const theme = useChartTheme();
  const { mapConsent, places: savedPlaces } = useSettings();
  const { trips, loading } = useDataset();

  const [sessionConsent, setSessionConsent] = useState(false);
  const [remember, setRemember] = useState(false);
  const [layers, setLayers] = useState<MapLayers>({ lines: true, heat: true, places: true });
  const [fitToken, setFitToken] = useState(0);
  const [combined, setCombined] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const analysis = useMemo(() => analyzePlaces(trips, savedPlaces), [trips, savedPlaces]);
  const geo = useMemo(() => geography(trips, analysis.places, analysis.home, analysis.work), [trips, analysis]);
  const routes = useMemo(() => frequentRoutes(trips, analysis.assignments, { combined, limit: TOP_ROUTES }), [trips, analysis, combined]);
  const mapData = useMemo(() => buildMapData(trips, analysis, geo.bounds), [trips, analysis, geo.bounds]);
  const pins = useMemo(
    () =>
      [
        analysis.home && { lat: analysis.home.lat, lon: analysis.home.lon, text: t('home'), above: true },
        analysis.work && { lat: analysis.work.lat, lon: analysis.work.lon, text: t('work') },
      ].filter((p): p is { lat: number; lon: number; text: string; above?: boolean } => !!p),
    [analysis, t],
  );
  const mapLocale = useMemo(
    () => ({
      'Map.Title': t('map.title'),
      'NavigationControl.ZoomIn': t('map.zoomIn'),
      'NavigationControl.ZoomOut': t('map.zoomOut'),
      'Popup.Close': t('map.closePopup'),
      'AttributionControl.ToggleAttribution': t('map.attribution'),
      'CooperativeGesturesHandler.WindowsHelpText': t('map.gestureWindows'),
      'CooperativeGesturesHandler.MacHelpText': t('map.gestureMac'),
      'CooperativeGesturesHandler.MobileHelpText': t('map.gestureMobile'),
    }),
    [t],
  );
  const popupContent = useMemo(
    () => (id: string) => {
      const place = analysis.byId.get(id);
      return place ? buildPlacePopup(place, f, t) : null;
    },
    [analysis, f, t],
  );

  if (loading) return null;
  if (trips.length === 0) {
    return (
      <Page overline={t('overline')} title={t('title')} lead={t('lead')}>
        <EmptyState />
      </Page>
    );
  }

  const allowed = mapConsent || sessionConsent;
  const hasPlaces = analysis.places.length > 0;
  const toggle = (key: keyof MapLayers) => setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  const placeLabel = (id: string) => analysis.byId.get(id)?.label ?? '–';
  const placeLink = (p: Place) => <a href={href('trips', { place: p.id })}>{p.label}</a>;
  const shownPlaces = showAll ? analysis.places.slice(0, MAX_ALL_PLACES) : analysis.places.slice(0, TOP_PLACES);

  return (
    <Page overline={t('overline')} title={t('title')} lead={t('lead')}>
      {allowed && hasPlaces && (
        <div className="map-toolbar">
          <div className="map-layers" role="group" aria-label={t('layers.label')}>
            {(['places', 'heat', 'lines'] as const).map((key) => (
              <label key={key}>
                <input type="checkbox" checked={layers[key]} onChange={() => toggle(key)} />
                {t(`layers.${key}`)}
              </label>
            ))}
          </div>
          <button type="button" className="button button-secondary button-small" onClick={() => setFitToken((n) => n + 1)}>
            {t('fit')}
          </button>
        </div>
      )}

      <div className="map-frame">
        {!allowed ? (
          <div className="map-gate">
            <h2>{t('consent.title')}</h2>
            <p>{t('consent.body')}</p>
            <p>{t('consent.local')}</p>
            <div className="map-gate-actions">
              <button
                type="button"
                className="button"
                onClick={() => {
                  setSessionConsent(true);
                  if (remember) updateSettings({ mapConsent: true });
                }}
              >
                {t('consent.load')}
              </button>
              <label>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                {t('consent.remember')}
              </label>
            </div>
          </div>
        ) : !hasPlaces ? (
          <div className="map-gate">
            <h2>{t('noCoords.title')}</h2>
            <p>{t('noCoords.body')}</p>
          </div>
        ) : (
          <Suspense fallback={null}>
            <PlacesMap
              data={mapData}
              layers={layers}
              theme={theme}
              fitToken={fitToken}
              pins={pins}
              popupContent={popupContent}
              locale={mapLocale}
            />
          </Suspense>
        )}
      </div>
      {allowed && hasPlaces && (
        <p className="map-legend">
          <span>
            <i style={{ background: theme.ink }} />
            {t('home')}
          </span>
          <span>
            <i style={{ background: theme.series[1] }} />
            {t('work')}
          </span>
          <span>
            <i style={{ background: theme.accent }} />
            {t('legend.other')}
          </span>
          <span>{t('legend.lines')}</span>
        </p>
      )}

      <Section title={t('stats.title')} note={t('stats.note')}>
        <Stats>
          <Stat
            label={t('stats.places')}
            value={f.number(geo.uniquePlaces)}
            hint={analysis.home ? t('stats.homeHint', { place: analysis.home.label }) : t('stats.noHome')}
            accent
          />
          <Stat label={t('stats.towns')} value={f.number(geo.towns.length)} />
          <Stat
            label={t('stats.countries')}
            value={f.number(geo.countries.length)}
            hint={
              geo.countries
                .slice(0, 3)
                .map((c) => c.name)
                .join(', ') || undefined
            }
          />
          <Stat
            label={t('stats.farthest')}
            value={geo.farthest ? f.number(f.distanceValue(geo.farthest.distanceKm)) : '–'}
            unit={geo.farthest ? f.distanceUnit : undefined}
            hint={geo.farthest ? t('stats.farthestHint', { place: geo.farthest.place.label }) : t('stats.needsHome')}
          />
          <Stat
            label={t('stats.homeWork')}
            value={geo.homeToWorkKm == null ? '–' : f.number(f.distanceValue(geo.homeToWorkKm), 1)}
            unit={geo.homeToWorkKm == null ? undefined : f.distanceUnit}
            hint={geo.homeToWorkKm == null ? t('stats.needsWork') : t('stats.airLine')}
          />
        </Stats>
      </Section>
      <Section title={t('places.title')} note={t('places.note')}>
        <div className="panel panel-flush table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('col.place')}</th>
                <th className="map-col-secondary">{t('col.town')}</th>
                <th className="num">{t('col.visits')}</th>
                <th className="num">{t('col.dwell')}</th>
                <th className="num map-col-secondary">{t('col.share')}</th>
                <th className="num map-col-secondary">{t('col.first')}</th>
                <th className="num map-col-secondary">{t('col.last')}</th>
              </tr>
            </thead>
            <tbody>
              {shownPlaces.map((p) => (
                <tr key={p.id}>
                  <td>
                    {placeLink(p)}
                    {(p.isHome || p.isWork) && (
                      <span className="place-cell-tags">
                        {p.isHome && <span className="tag tag-accent">{t('home')}</span>}
                        {p.isWork && <span className="tag tag-accent">{t('work')}</span>}
                      </span>
                    )}
                  </td>
                  <td className="map-col-secondary">{p.town || '–'}</td>
                  <td className="num">{f.number(p.visits)}</td>
                  <td className="num">{p.dwellMedianMin == null ? '–' : dwellText(p.dwellMedianMin, f, t)}</td>
                  <td className="num map-col-secondary">{f.percent(p.tripShare * 100)}</td>
                  <td className="num map-col-secondary">{f.date(p.firstVisit)}</td>
                  <td className="num map-col-secondary">{f.date(p.lastVisit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {analysis.places.length > TOP_PLACES && (
          <div className="table-more">
            <button type="button" className="button button-secondary button-small" onClick={() => setShowAll((v) => !v)}>
              {showAll ? t('places.fewer') : t('places.all', { count: Math.min(analysis.places.length, MAX_ALL_PLACES) })}
            </button>
          </div>
        )}
      </Section>

      <Section
        title={t('routes.title')}
        note={t('routes.note')}
        aside={
          <Segmented
            label={t('routes.mode')}
            value={combined ? 'combined' : 'directed'}
            onChange={(v) => setCombined(v === 'combined')}
            options={[
              { value: 'directed', label: t('routes.directed') },
              { value: 'combined', label: t('routes.combined') },
            ]}
          />
        }
      >
        {routes.length === 0 ? (
          <p className="muted">{t('routes.none')}</p>
        ) : (
          <div className="panel panel-flush table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('routes.route')}</th>
                  <th className="num">{t('routes.trips')}</th>
                  <th className="num">{t('routes.distance')}</th>
                  <th className="num">{t('routes.consumption')}</th>
                  <th className="num">{t('routes.duration')}</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={r.key}>
                    <td>
                      {placeLabel(r.from)} <span className="muted">{r.directed ? '→' : '↔'}</span> {placeLabel(r.to)}
                    </td>
                    <td className="num">{f.number(r.count)}</td>
                    <td className="num">{f.distance(r.avgDistanceKm, r.avgDistanceKm < 10 ? 1 : 0)}</td>
                    <td className="num">{r.consumption == null ? '–' : f.consumption(r.consumption)}</td>
                    <td className="num">{f.duration(r.avgDurationMin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={t('geo.title')} note={t('geo.note')}>
        <div className="grid grid-2 geo-grid">
          <div className="panel panel-flush table-wrap">
            <table className="table geo-list">
              <thead>
                <tr>
                  <th>{t('geo.country')}</th>
                  <th className="num">{t('geo.arrivals')}</th>
                  <th className="num map-col-secondary">{t('col.last')}</th>
                </tr>
              </thead>
              <tbody>
                {geo.countries.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td className="num">{f.number(c.visits)}</td>
                    <td className="num">{f.date(c.lastVisit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel panel-flush table-wrap">
            <table className="table geo-list">
              <thead>
                <tr>
                  <th>{t('geo.town')}</th>
                  <th className="num">{t('geo.arrivals')}</th>
                  <th className="num map-col-secondary">{t('col.last')}</th>
                </tr>
              </thead>
              <tbody>
                {geo.towns.slice(0, TOP_TOWNS).map((c) => (
                  <tr key={`${c.name}|${c.country}`}>
                    <td>
                      {c.name}
                      {geo.countries.length > 1 && c.country && <span className="muted">, {c.country}</span>}
                    </td>
                    <td className="num">{f.number(c.visits)}</td>
                    <td className="num">{f.date(c.lastVisit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {geo.towns.length > TOP_TOWNS && (
              <p className="section-note geo-more">{t('geo.moreTowns', { count: geo.towns.length - TOP_TOWNS })}</p>
            )}
          </div>
        </div>
      </Section>
    </Page>
  );
}
