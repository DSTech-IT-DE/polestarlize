import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { StoredTrip } from '../domain/trip';
import { useAllTrips } from './useTrips';

/** `all`, `30d`, `90d`, `12m` or a calendar year like `2026`. */
export type Period = string;

interface Dataset {
  /** Trips inside the selected period, oldest first. */
  trips: StoredTrip[];
  /** Every stored trip, oldest first. */
  allTrips: StoredTrip[];
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
  const [period, setPeriod] = useState<Period>(() => sessionStorage.getItem('polestarlize.period') ?? 'all');
  const value = useMemo<Dataset>(() => {
    const allTrips = all ?? [];
    const years = [...new Set(allTrips.map((t) => t.start.slice(0, 4)))].sort().reverse();
    const effective = /^\d{4}$/.test(period) && !years.includes(period) ? 'all' : period;
    return {
      trips: filterByPeriod(allTrips, effective),
      allTrips,
      loading: all === undefined,
      period: effective,
      setPeriod: (p) => {
        sessionStorage.setItem('polestarlize.period', p);
        setPeriod(p);
      },
      years,
    };
  }, [all, period]);
  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}

export function useDataset(): Dataset {
  const ctx = useContext(DatasetContext);
  if (!ctx) throw new Error('useDataset must be used inside DatasetProvider');
  return ctx;
}
