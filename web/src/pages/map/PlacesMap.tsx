import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl';
// Vite bundles the worker with its imports; MapLibre's own relative URL breaks in the dev server's dependency cache.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import type { ChartTheme } from '../../ui/chart/theme';

/** Minimal GeoJSON shapes; the `geojson` type package is not a dependency. */
export interface FeatureCollection {
  type: 'FeatureCollection';
  features: { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }[];
}
type PlaceCollection = FeatureCollection;

export interface MapLayers {
  lines: boolean;
  heat: boolean;
  places: boolean;
}

export interface MapData {
  /** One straight start → end line per trip. */
  lines: FeatureCollection;
  /** Start and end point of every trip. */
  endpoints: FeatureCollection;
  /** Properties: `id`, `label`, `visits`, `kind` (`home`, `work`, `other`). */
  places: PlaceCollection;
  /** [west, south, east, north] */
  bounds: [number, number, number, number] | null;
}

interface Props {
  data: MapData;
  layers: MapLayers;
  theme: ChartTheme;
  /** Increment to fit the view to the data again. */
  fitToken: number;
  /** Labels for the pinned places (home, work). */
  pins: { lat: number; lon: number; text: string; above?: boolean }[];
  popupContent: (placeId: string) => HTMLElement | null;
  locale: Record<string, string>;
}

maplibregl.setWorkerUrl(workerUrl);

// OpenFreeMap serves vector tiles without an API key. `dark` may not exist on every deployment, so a
// failing style falls through to the next candidate and finally to a plain background.
const LIGHT_STYLES = ['https://tiles.openfreemap.org/styles/positron'];
const DARK_STYLES = ['https://tiles.openfreemap.org/styles/dark', 'https://tiles.openfreemap.org/styles/positron'];

function plainStyle(theme: ChartTheme): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': theme.bg } }] };
}

function styleAt(index: number, theme: ChartTheme): string | StyleSpecification {
  const list = theme.dark ? DARK_STYLES : LIGHT_STYLES;
  return index < list.length ? list[index] : plainStyle(theme);
}

/** `#rrggbb` → `rgba(…)`; other colour notations are returned unchanged. */
function withAlpha(colour: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (!m) return colour;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Adds the data layers if the current style does not have them yet and applies colours and visibility. */
function syncLayers(map: maplibregl.Map, p: Props, sourceData: Map<string, unknown>) {
  const { theme, layers, data } = p;
  const sources: [string, FeatureCollection][] = [
    ['trip-lines', data.lines],
    ['trip-endpoints', data.endpoints],
    ['places', data.places],
  ];
  for (const [id, fc] of sources) {
    const source = map.getSource(id) as GeoJSONSource | undefined;
    if (!source) {
      map.addSource(id, { type: 'geojson', data: fc });
      sourceData.set(id, fc);
    } else if (sourceData.get(id) !== fc) {
      source.setData(fc);
      sourceData.set(id, fc);
    }
  }

  const visibility = (on: boolean) => (on ? 'visible' : 'none');
  const ramp = theme.sequential;
  const heatColour: maplibregl.ExpressionSpecification = [
    'interpolate',
    ['linear'],
    ['heatmap-density'],
    0,
    withAlpha(ramp[2], 0),
    0.12,
    withAlpha(ramp[2], 0.8),
    0.4,
    ramp[2],
    0.6,
    ramp[3],
    0.8,
    ramp[4],
    1,
    ramp[5],
  ];
  const heatPaint = {
    'heatmap-weight': 1,
    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 13, 3],
    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 8, 9, 20, 14, 40],
    'heatmap-opacity': 0.85,
    'heatmap-color': heatColour,
  } as const;
  const linePaint = { 'line-color': theme.accent, 'line-width': 1, 'line-opacity': theme.dark ? 0.3 : 0.2 } as const;
  const kindColour: maplibregl.ExpressionSpecification = [
    'match',
    ['get', 'kind'],
    'home',
    theme.ink,
    'work',
    theme.series[1],
    theme.accent,
  ];
  const circlePaint = {
    'circle-radius': ['min', 22, ['+', 4, ['*', 1.7, ['sqrt', ['get', 'visits']]]]],
    'circle-color': kindColour,
    'circle-opacity': 0.8,
    'circle-stroke-color': theme.surface,
    'circle-stroke-width': 2,
  } as const;

  if (!map.getLayer('heat')) map.addLayer({ id: 'heat', type: 'heatmap', source: 'trip-endpoints', paint: heatPaint as never });
  if (!map.getLayer('lines'))
    map.addLayer({ id: 'lines', type: 'line', source: 'trip-lines', layout: { 'line-cap': 'round' }, paint: linePaint });
  if (!map.getLayer('places')) map.addLayer({ id: 'places', type: 'circle', source: 'places', paint: circlePaint as never });

  for (const [key, value] of Object.entries(heatPaint)) map.setPaintProperty('heat', key as never, value as never);
  for (const [key, value] of Object.entries(linePaint)) map.setPaintProperty('lines', key as never, value as never);
  for (const [key, value] of Object.entries(circlePaint)) map.setPaintProperty('places', key as never, value as never);
  map.setLayoutProperty('heat', 'visibility', visibility(layers.heat));
  map.setLayoutProperty('lines', 'visibility', visibility(layers.lines));
  map.setLayoutProperty('places', 'visibility', visibility(layers.places));
}

export default function PlacesMap(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const sourceData = useRef(new Map<string, unknown>());
  const styleIndex = useRef(0);
  const fittedKey = useRef('');

  const fit = (map: maplibregl.Map) => {
    const b = latest.current.data.bounds;
    if (b)
      map.fitBounds(
        [
          [b[0], b[1]],
          [b[2], b[3]],
        ],
        { padding: 48, maxZoom: 14, duration: 0 },
      );
  };

  // Create the map once.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    styleIndex.current = 0;
    const map = new maplibregl.Map({
      container: el,
      style: styleAt(0, latest.current.theme),
      center: [10, 50],
      zoom: 4,
      attributionControl: { compact: true },
      cooperativeGestures: true,
      locale: latest.current.locale,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('style.load', () => {
      sourceData.current.clear();
      syncLayers(map, latest.current, sourceData.current);
    });
    // A style that cannot be loaded (unknown name, blocked host) falls back to the next one.
    map.on('error', (e: { error?: unknown }) => {
      const url = (e.error as { url?: string } | undefined)?.url ?? '';
      if (!url.includes('/styles/')) return;
      styleIndex.current += 1;
      map.setStyle(styleAt(styleIndex.current, latest.current.theme));
    });
    map.on('click', 'places', (e: { features?: { properties?: Record<string, unknown>; geometry: unknown }[] }) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const content = latest.current.popupContent(String(feature.properties?.id));
      if (!content) return;
      const [lon, lat] = (feature.geometry as { coordinates: number[] }).coordinates;
      new maplibregl.Popup({ maxWidth: '300px', offset: 10 }).setLngLat([lon, lat]).setDOMContent(content).addTo(map);
    });
    map.on('mouseenter', 'places', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'places', () => (map.getCanvas().style.cursor = ''));

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(el);
    fit(map);
    return () => {
      observer.disconnect();
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Light/dark switch: load the matching style, layers come back with `style.load`.
  const dark = props.theme.dark;
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    styleIndex.current = 0;
    map.setStyle(styleAt(0, latest.current.theme));
  }, [dark]);

  // Data, layer toggles and colours.
  useEffect(() => {
    const map = mapRef.current;
    if (map?.isStyleLoaded()) syncLayers(map, props, sourceData.current);
    else if (map) map.once('style.load', () => syncLayers(map, latest.current, sourceData.current));
  }, [props.data, props.layers, props.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit to the data when it (or the token) changes.
  useEffect(() => {
    const map = mapRef.current;
    const b = props.data.bounds;
    if (!map || !b) return;
    const key = `${b.join(',')}|${props.fitToken}`;
    if (key === fittedKey.current) return;
    fittedKey.current = key;
    fit(map);
  }, [props.data.bounds, props.fitToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Labels of home and work are DOM markers so they work without glyph servers and follow the theme.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markers.current.forEach((m) => m.remove());
    markers.current = props.pins.map((pin) => {
      const el = document.createElement('div');
      el.className = 'map-pin';
      el.textContent = pin.text;
      return new maplibregl.Marker({ element: el, anchor: pin.above ? 'bottom' : 'top', offset: [0, pin.above ? -12 : 12] })
        .setLngLat([pin.lon, pin.lat])
        .addTo(map);
    });
  }, [props.pins]);

  return <div ref={container} className="places-map" role="application" aria-label={props.locale['Map.Title']} />;
}
