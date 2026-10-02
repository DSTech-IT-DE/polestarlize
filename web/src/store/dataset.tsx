import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { checkTrips, type TripCheck } from '../analytics/plausibility';
import type { StoredTrip } from '../domain/trip';
import { useSettings } from '../lib/settings';
import { useAllTrips } from './useTrips';

/** `all`, `30d`, `90d`, `12m` or a calendar year like `2026`. */
export type Period = string;

interface Dataset {
  /** Counted trips inside the selected period, oldest first. Excluded and unreviewed suspicious trips are left out. */
  trips: StoredTrip[];
  /** Every counted trip, oldest first. */
  allTrips: StoredTrip[];
  /** Every stored trip inside the selected period, including the ones left out of the analyses. */
  recordedTrips: StoredTrip[];
  /** Every stored trip, including the ones left out of the analyses. */
  allRecordedTrips: StoredTrip[];
  /** Plausibility result and review status per trip id. */
  checks: Map<string, TripCheck>;
  /** Suspicious trips without a decision, over all periods. */
  pendingReview: number;
  loading: boolean;
  period: Period;
  setPeriod: (period: Period) => void;
  /** Calendar years that contain trips, newest first. */
  years: string[];
}

const DatasetContext = createContext<Dataset | null>(null);

const pad = (n: number) => String(n).padStart(2, '0');

function periodStart(period: Period, latest: string): string | null {
  if (period === 'all' || /^\d{4}$/.test(period)) return null;
  const date = new Date(latest.slice(0, 10) + 'T00:00:00');
  if (period === '30d') date.setDate(date.getDate() - 30);
  else if (period === '90d') date.setDate(date.getDate() - 90);
  else if (period === '12m') date.setFullYear(date.getFullYear() - 1);
  else return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T00:00`;
}

export function filterByPeriod<T extends { start: string }>(trips: readonly T[], period: Period): T[] {
  if (period === 'all' || trips.length === 0) return [...trips];
  if (/^\d{4}$/.test(period)) return trips.filter((t) => t.start.startsWith(period));
  // Relative periods end at the most recent trip, not today, so old exports still show data.
  const from = periodStart(period, trips[trips.length - 1].start);
  return from ? trips.filter((t) => t.start >= from) : [...trips];
}

export function DatasetProvider({ children }: { children: ReactNode }) {
  const all = useAllTrips();
  const { usableCapacityKwh } = useSettings();
  const [period, setPeriod] = useState<Period>(() => sessionStorage.getItem('polestarlize.period') ?? 'all');
  const value = useMemo<Dataset>(() => {
    const allRecordedTrips = all ?? [];
    const { counted: allTrips, checks, pendingReview } = checkTrips(allRecordedTrips, { capacityKwh: usableCapacityKwh });
    const years = [...new Set(allRecordedTrips.map((t) => t.start.slice(0, 4)))].sort().reverse();
    const effective = /^\d{4}$/.test(period) && !years.includes(period) ? 'all' : period;
    // Relative periods are anchored on the latest recorded trip, so both lists cover the same span.
    const recordedTrips = filterByPeriod(allRecordedTrips, effective);
    const recordedIds = new Set(recordedTrips.map((t) => t.id));
    return {
      trips: allTrips.filter((t) => recordedIds.has(t.id)),
      allTrips,
      recordedTrips,
      allRecordedTrips,
      checks,
      pendingReview,
      loading: all === undefined,
      period: effective,
      setPeriod: (p) => {
        sessionStorage.setItem('polestarlize.period', p);
        setPeriod(p);
      },
      years,
    };
  }, [all, period, usableCapacityKwh]);
  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}

export function useDataset(): Dataset {
  const ctx = useContext(DatasetContext);
  if (!ctx) throw new Error('useDataset must be used inside DatasetProvider');
  return ctx;
}
