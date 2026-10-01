import { useSyncExternalStore } from 'react';

/**
 * Tiny hash router. Hash URLs work on GitHub Pages without a server-side
 * fallback and in the Docker image alike.
 */
export type RouteId =
  | 'overview'
  | 'import'
  | 'trips'
  | 'map'
  | 'battery'
  | 'charging'
  | 'driving'
  | 'costs'
  | 'settings';

export const ROUTES: RouteId[] = ['overview', 'trips', 'map', 'battery', 'charging', 'driving', 'costs', 'import', 'settings'];

function parse(): { route: RouteId; params: URLSearchParams } {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const route = (ROUTES as string[]).includes(path) ? (path as RouteId) : 'overview';
  return { route, params: new URLSearchParams(query) };
}

let snapshot = parse();
let key = location.hash;

function subscribe(listener: () => void) {
  const handler = () => {
    if (location.hash !== key) {
      key = location.hash;
      snapshot = parse();
      window.scrollTo({ top: 0 });
    }
    listener();
  };
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}

export function useRoute() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function href(route: RouteId, params?: Record<string, string>): string {
  const query = params ? `?${new URLSearchParams(params).toString()}` : '';
  return `#/${route === 'overview' ? '' : route}${query}`;
}

export function navigate(route: RouteId, params?: Record<string, string>): void {
  location.hash = href(route, params);
}
