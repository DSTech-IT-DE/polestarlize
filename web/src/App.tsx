import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { useRoute, type RouteId } from './lib/router';
import { DatasetProvider } from './store/dataset';
import { Shell } from './ui/Shell';

const PAGES: Record<RouteId, LazyExoticComponent<ComponentType>> = {
  overview: lazy(() => import('./pages/overview/OverviewPage')),
  import: lazy(() => import('./pages/import/ImportPage')),
  trips: lazy(() => import('./pages/trips/TripsPage')),
  map: lazy(() => import('./pages/map/MapPage')),
  battery: lazy(() => import('./pages/battery/BatteryPage')),
  charging: lazy(() => import('./pages/charging/ChargingPage')),
  driving: lazy(() => import('./pages/driving/DrivingPage')),
  costs: lazy(() => import('./pages/costs/CostsPage')),
  settings: lazy(() => import('./pages/settings/SettingsPage')),
};

export function App() {
  const { route } = useRoute();
  const Page = PAGES[route];
  return (
    <DatasetProvider>
      <Shell route={route}>
        <Page />
      </Shell>
    </DatasetProvider>
  );
}
