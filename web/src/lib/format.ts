import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { KM_PER_MILE, toDate } from '../domain/trip';
import { useSettings } from './settings';

/**
 * Locale and unit aware formatting. All inputs are metric (km, kWh/100 km);
 * conversion to miles happens here only.
 */
export function createFormatter(locale: string, unit: 'km' | 'mi', currency: string) {
  const nf = (digits: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const cache = new Map<number, Intl.NumberFormat>();
  const num = (value: number, digits = 0) => {
    let f = cache.get(digits);
    if (!f) cache.set(digits, (f = nf(digits)));
    return f.format(value);
  };
  const toUnit = (km: number) => (unit === 'mi' ? km / KM_PER_MILE : km);

  return {
    locale,
    unit,
    distanceUnit: unit,
    consumptionUnit: unit === 'mi' ? 'kWh/100 mi' : 'kWh/100 km',
    number: num,
    percent: (value: number, digits = 0) => `${num(value, digits)} %`,
    /** Converts km to the display unit without formatting. */
    distanceValue: toUnit,
    distance: (km: number, digits = 0) => `${num(toUnit(km), digits)} ${unit}`,
    /** kWh/100 km → display value (kWh/100 mi when needed). */
    consumptionValue: (per100km: number) => (unit === 'mi' ? per100km * KM_PER_MILE : per100km),
    consumption: (per100km: number, digits = 1) =>
      `${num(unit === 'mi' ? per100km * KM_PER_MILE : per100km, digits)} ${unit === 'mi' ? 'kWh/100 mi' : 'kWh/100 km'}`,
    energy: (kwh: number, digits = 1) => `${num(kwh, digits)} kWh`,
    speed: (kmh: number) => `${num(toUnit(kmh), 0)} ${unit === 'mi' ? 'mph' : 'km/h'}`,
    currency: (value: number, digits = 2) =>
      new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value),
    duration: (minutes: number) => {
      const h = Math.floor(minutes / 60);
      const m = Math.round(minutes % 60);
      return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
    },
    date: (local: string, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) =>
      new Intl.DateTimeFormat(locale, options).format(toDate(local)),
    dateTime: (local: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(toDate(local)),
    month: (yyyyMm: string, style: 'short' | 'long' = 'short') =>
      new Intl.DateTimeFormat(locale, { month: style, year: 'numeric' }).format(toDate(`${yyyyMm}-01T00:00`)),
    weekdayNames: (style: 'short' | 'long' = 'short') =>
      // Monday first.
      Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: style }).format(new Date(2024, 0, 1 + i))),
  };
}

export type Formatter = ReturnType<typeof createFormatter>;

export function useFormat(): Formatter {
  const { i18n } = useTranslation();
  const { distanceUnit, currency } = useSettings();
  const locale = i18n.resolvedLanguage ?? 'en';
  return useMemo(() => createFormatter(locale, distanceUnit, currency), [locale, distanceUnit, currency]);
}
