/**
 * Column names used by the Journey Log export. Matching is case-insensitive and
 * ignores whitespace and punctuation, so small variations between app versions
 * still map to the right field.
 */
export const COLUMN_ALIASES = {
  start: ['Start Date', 'Start Time'],
  end: ['End Date', 'End Time'],
  startAddress: ['Start Address'],
  endAddress: ['End Address'],
  distanceKm: ['Distance in KM', 'Distance (km)', 'Distance km'],
  distanceMi: ['Distance in Mile', 'Distance in Miles', 'Distance (mi)', 'Distance mi'],
  energyKwh: ['Consumption in Kwh', 'Consumption (kWh)', 'Energy in kWh'],
  category: ['Category'],
  startLat: ['Start Latitude'],
  startLon: ['Start Longitude'],
  endLat: ['End Latitude'],
  endLon: ['End Longitude'],
  startOdometer: ['Start Odometer'],
  endOdometer: ['End Odometer'],
  tripType: ['Trip Type'],
  socStart: ['SOC Source', 'SOC Start'],
  socEnd: ['SOC Destination', 'SOC End'],
  comment: ['Comments', 'Comment'],
} as const;

export type ColumnField = keyof typeof COLUMN_ALIASES;

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Maps every known field to the index of its column, or -1 if absent. */
export function mapColumns(headers: readonly string[]): Record<ColumnField, number> {
  const normalized = headers.map(normalizeHeader);
  const result = {} as Record<ColumnField, number>;
  for (const field of Object.keys(COLUMN_ALIASES) as ColumnField[]) {
    const candidates = COLUMN_ALIASES[field].map(normalizeHeader);
    result[field] = normalized.findIndex((h) => candidates.includes(h));
  }
  return result;
}
