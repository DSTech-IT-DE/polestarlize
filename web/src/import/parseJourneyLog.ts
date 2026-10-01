import Papa from 'papaparse';
import { KM_PER_MILE, tripId, type DistanceUnit, type Trip } from '../domain/trip';
import { mapColumns, type ColumnField } from './columns';
import { parseLocalDate, parseNumber, parseText } from './values';
import { readFirstSheet, type Cell } from './xlsx';

export interface ParseResult {
  trips: Trip[];
  unit: DistanceUnit;
  /** Data rows that could not be turned into a trip (missing dates etc.). */
  skipped: number;
}

export class JourneyLogFormatError extends Error {
  constructor(public readonly code: 'not-journey-log' | 'empty' | 'unreadable', message: string) {
    super(message);
    this.name = 'JourneyLogFormatError';
  }
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Turns a table (first row = headers) into trips. */
export function tableToTrips(table: readonly (readonly Cell[])[]): ParseResult {
  const headerIndex = table.findIndex((row) => row.some((c) => c != null && String(c).trim() !== ''));
  if (headerIndex < 0) throw new JourneyLogFormatError('empty', 'The file contains no rows.');
  const headers = table[headerIndex].map((c) => (c == null ? '' : String(c).replace(/^﻿/, '')));
  const cols = mapColumns(headers);
  const unit: DistanceUnit = cols.distanceMi >= 0 && cols.distanceKm < 0 ? 'mi' : 'km';
  const distanceCol = unit === 'mi' ? cols.distanceMi : cols.distanceKm;
  if (cols.start < 0 || cols.end < 0 || distanceCol < 0) {
    throw new JourneyLogFormatError('not-journey-log', 'Missing the "Start Date", "End Date" or distance column.');
  }
  const factor = unit === 'mi' ? KM_PER_MILE : 1;
  const trips: Trip[] = [];
  let skipped = 0;

  for (const row of table.slice(headerIndex + 1)) {
    if (!row.some((c) => c != null && String(c).trim() !== '')) continue;
    const get = (field: ColumnField): Cell => (cols[field] >= 0 ? (row[cols[field]] ?? null) : null);
    const num = (field: ColumnField) => parseNumber(get(field));
    const start = parseLocalDate(get('start'));
    const end = parseLocalDate(get('end'));
    const distance = parseNumber(row[distanceCol]);
    if (!start || !end || distance == null) {
      skipped++;
      continue;
    }
    const startOdo = num('startOdometer');
    const endOdo = num('endOdometer');
    const energy = num('energyKwh');
    const startOdometerKm = startOdo == null ? null : Math.round(startOdo * factor);
    trips.push({
      id: tripId(start, startOdometerKm),
      start,
      end,
      startAddress: parseText(get('startAddress')),
      endAddress: parseText(get('endAddress')),
      distanceKm: round(distance * factor, 2),
      energyKwh: energy != null && energy > 0 ? energy : null,
      category: parseText(get('category')) || 'Uncategorized',
      startLat: num('startLat'),
      startLon: num('startLon'),
      endLat: num('endLat'),
      endLon: num('endLon'),
      startOdometerKm,
      endOdometerKm: endOdo == null ? null : Math.round(endOdo * factor),
      tripType: parseText(get('tripType')).toUpperCase() || 'SINGLE',
      socStart: num('socStart'),
      socEnd: num('socEnd'),
      comment: parseText(get('comment')),
    });
  }
  if (trips.length === 0 && skipped === 0) throw new JourneyLogFormatError('empty', 'The file contains no trips.');
  return { trips, unit, skipped };
}

export function parseCsv(text: string): ParseResult {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  if (result.data.length === 0) throw new JourneyLogFormatError('empty', 'The file contains no rows.');
  return tableToTrips(result.data);
}

export function parseXlsx(data: Uint8Array): ParseResult {
  let table: Cell[][];
  try {
    table = readFirstSheet(data);
  } catch (error) {
    throw new JourneyLogFormatError('unreadable', (error as Error).message);
  }
  return tableToTrips(table);
}

/** Parses an export file picked or dropped by the user. */
export async function parseJourneyLogFile(file: File): Promise<ParseResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip || /\.xlsx$/i.test(file.name)) return parseXlsx(bytes);
  return parseCsv(new TextDecoder('utf-8').decode(bytes));
}
