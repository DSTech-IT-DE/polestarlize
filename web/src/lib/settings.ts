import { useSyncExternalStore } from 'react';
import type { DistanceUnit } from '../domain/trip';
import { sanitizeSavedPlaces, type SavedPlace } from './savedPlaces';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePreference;
  distanceUnit: DistanceUnit;
  /** Id from `VEHICLES` or `custom`. */
  vehicle: string;
  /** Nominal usable battery capacity in kWh, reference for battery health. */
  usableCapacityKwh: number;
  currency: string;
  /** Price per kWh when charging at home. */
  homePrice: number;
  /** Price per kWh at public chargers. */
  publicPrice: number;
  /** Share of energy charged at home, 0..1. Only used with `priceMix: 'manual'`. */
  homeShare: number;
  /** `places`: price per kWh from the charging sessions and the price of each place; `manual`: fixed home share. */
  priceMix: 'places' | 'manual';
  /** Charging places the user marked as home/work or gave a price. */
  places: SavedPlace[];
  /** Petrol price per litre, used for the comparison with a combustion car. */
  fuelPrice: number;
  /** Consumption of the comparison combustion car in l/100 km. */
  fuelConsumption: number;
  /** Energy lost between wall plug and battery in percent (charger and battery heat). */
  chargingLossPercent: number;
  /** Carbon intensity of the electricity in g CO2 per kWh (Germany: roughly 380). */
  gridCo2: number;
  /** Base URL of a sync server. Empty = same origin (Docker) when available. */
  syncServerUrl: string;
  /** The user agreed to load map tiles from a third-party tile server. */
  mapConsent: boolean;
  /** ISO time of the last change to a synced setting; `''` = never changed. Used for last-write-wins sync. */
  updatedAt: string;
}

/** Settings that stay on this device and are never synced. */
export const LOCAL_ONLY_SETTINGS: readonly (keyof Settings)[] = ['theme', 'syncServerUrl', 'mapConsent', 'updatedAt'];

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  distanceUnit: 'km',
  vehicle: 'ps2-lr-2024',
  usableCapacityKwh: 79,
  currency: 'EUR',
  homePrice: 0.32,
  publicPrice: 0.59,
  homeShare: 0.8,
  priceMix: 'places',
  places: [],
  fuelPrice: 1.75,
  fuelConsumption: 6.5,
  chargingLossPercent: 10,
  gridCo2: 380,
  syncServerUrl: '',
  mapConsent: false,
  updatedAt: '',
};

/** The settings that follow the user to other devices and into backups. */
export function syncedSettings(settings: Settings): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!LOCAL_ONLY_SETTINGS.includes(key as keyof Settings)) data[key] = value;
  }
  return data;
}

/**
 * Keeps only known, synced keys whose type matches the defaults, for settings
 * from a sync server or a backup. A newer client may know more keys.
 */
export function acceptRemoteSettings(data: Record<string, unknown>): Partial<Settings> {
  const accepted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (LOCAL_ONLY_SETTINGS.includes(key as keyof Settings)) continue;
    const fallback = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
    if (key === 'places') {
      const places = sanitizeSavedPlaces(value);
      if (places) accepted.places = places;
    } else if (key === 'priceMix') {
      if (value === 'places' || value === 'manual') accepted.priceMix = value;
    } else if (fallback !== undefined && typeof value === typeof fallback) {
      accepted[key] = value;
    }
  }
  return accepted as Partial<Settings>;
}

const STORAGE_KEY = 'polestarlize.settings';
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current: Settings = load();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  const touchesSynced = Object.keys(patch).some((key) => !LOCAL_ONLY_SETTINGS.includes(key as keyof Settings));
  // An explicit `updatedAt` in the patch comes from the sync itself and must not be overwritten.
  current = { ...current, ...(touchesSynced ? { updatedAt: new Date().toISOString() } : {}), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Settings then only live for this session.
  }
  for (const listener of listeners) listener();
}

export function subscribeSettings(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings);
}
