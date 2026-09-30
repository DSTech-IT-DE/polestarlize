import Papa from 'papaparse';
import type { Trip } from '../domain/trip';

export const JOURNEY_LOG_HEADERS = [
  'Start Date', 'End Date', 'Start Address', 'End Address', 'Distance in KM', 'Consumption in Kwh', 'Category',
  'Start Latitude', 'Start Longitude', 'End Latitude', 'End Longitude', 'Start Odometer', 'End Odometer',
  'Trip Type', 'SOC Source', 'SOC Destination', 'Comments',
] as const;

const exportDate = (local: string) => local.replace('T', ', ');
const cell = (value: number | string | null) => (value == null ? '' : String(value));

/** Writes trips in the same CSV layout the Journey Log app uses (newest first). */
export function toJourneyLogCsv(trips: readonly Trip[]): string {
  const rows = [...trips]
    .sort((a, b) => b.start.localeCompare(a.start))
    .map((t) => [
      exportDate(t.start), exportDate(t.end), t.startAddress, t.endAddress, cell(t.distanceKm), cell(t.energyKwh ?? 0),
      t.category, cell(t.startLat), cell(t.startLon), cell(t.endLat), cell(t.endLon), cell(t.startOdometerKm),
      cell(t.endOdometerKm), t.tripType, cell(t.socStart), cell(t.socEnd), t.comment,
    ]);
  return Papa.unparse({ fields: [...JOURNEY_LOG_HEADERS], data: rows }, { quotes: true, newline: '\n' });
}
