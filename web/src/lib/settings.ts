import { useSyncExternalStore } from 'react';
import type { DistanceUnit } from '../domain/trip';

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
  /** Share of energy charged at home, 0..1. */
  homeShare: number;
  /** Petrol price per litre, used for the comparison with a combustion car. */
  fuelPrice: number;
  /** Consumption of the comparison combustion car in l/100 km. */
  fuelConsumption: number;
  /** Base URL of a sync server. Empty = same origin (Docker) when available. */
  syncServerUrl: string;
  /** The user agreed to load map tiles from a third-party tile server. */
  mapConsent: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  distanceUnit: 'km',
  vehicle: 'ps2-lr-2024',
  usableCapacityKwh: 79,
  currency: 'EUR',
  homePrice: 0.32,
  publicPrice: 0.59,
  homeShare: 0.8,
  fuelPrice: 1.75,
  fuelConsumption: 6.5,
  syncServerUrl: '',
  mapConsent: false,
};

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
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Settings then only live for this session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}
