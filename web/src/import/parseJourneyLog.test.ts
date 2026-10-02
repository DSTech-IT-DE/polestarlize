import { existsSync, readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { generateDemoTrips } from '../lib/demoData';
import { toJourneyLogCsv } from './exportCsv';
import { JourneyLogFormatError, parseCsv, parseXlsx } from './parseJourneyLog';
import { parseLocalDate, parseNumber } from './values';

const SAMPLE = `﻿Start Date,End Date,Start Address,End Address,Distance in KM,Consumption in Kwh,Category,Start Latitude,Start Longitude,End Latitude,End Longitude,Start Odometer,End Odometer,Trip Type,SOC Source,SOC Destination,Comments
"2026-09-10, 15:04","2026-09-10, 15:08","Street 1, 12345 Town, Germany","Street 2, 12345 Town, Germany","4","1.415","Private","57.70","11.97","57.71","11.95","21500","21504","SINGLE","70","68",""
"2026-01-05, 07:10","2026-01-07, 12:21","Street 1, 12345 Town, Germany","Other 3, 12346 City, Germany","125","0","Uncategorized","57.70","11.97","57.78","11.81","12000","12125","MERGED","73","60","note"
`;

function buildXlsx(rows: (string | number)[][]): Uint8Array {
  const strings: string[] = [];
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
          if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
          strings.push(value);
          return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return zipSync({
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Trips" sheetId="1" r:id="rId4"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId4" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/sharedStrings.xml': strToU8(`<sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`),
  });
}

describe('value parsing', () => {
  it('parses the Journey Log date format and common alternatives', () => {
    expect(parseLocalDate('2026-09-10, 15:04')).toBe('2026-09-10T15:04');
    expect(parseLocalDate('2026-09-10 15:04:59')).toBe('2026-09-10T15:04');
    expect(parseLocalDate('10.09.2026 15:04')).toBe('2026-09-10T15:04');
    expect(parseLocalDate('9/10/2026, 3:04 PM')).toBe('2026-09-10T15:04');
    expect(parseLocalDate(46275.5)).toBe('2026-09-10T12:00');
    expect(parseLocalDate('2026-13-40, 10:00')).toBeNull();
    expect(parseLocalDate('')).toBeNull();
  });

  it('parses numbers with either decimal separator', () => {
    expect(parseNumber('1.415')).toBe(1.415);
    expect(parseNumber('1,415')).toBe(1.415);
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });
});

describe('parseCsv', () => {
  it('maps every column', () => {
    const { trips, unit, skipped } = parseCsv(SAMPLE);
    expect(unit).toBe('km');
    expect(skipped).toBe(0);
    expect(trips).toHaveLength(2);
    expect(trips[0]).toEqual({
      id: '2026-09-10T15:04|21500',
      start: '2026-09-10T15:04',
      end: '2026-09-10T15:08',
      startAddress: 'Street 1, 12345 Town, Germany',
      endAddress: 'Street 2, 12345 Town, Germany',
      distanceKm: 4,
      energyKwh: 1.415,
      category: 'Private',
      startLat: 57.7,
      startLon: 11.97,
      endLat: 57.71,
      endLon: 11.95,
      startOdometerKm: 21500,
      endOdometerKm: 21504,
      tripType: 'SINGLE',
      socStart: 70,
      socEnd: 68,
      comment: '',
    });
    expect(trips[1].energyKwh).toBeNull();
    expect(trips[1].tripType).toBe('MERGED');
    expect(trips[1].comment).toBe('note');
  });

  it('converts mile exports to kilometres', () => {
    const { trips, unit } = parseCsv(SAMPLE.replace('Distance in KM', 'Distance in Mile'));
    expect(unit).toBe('mi');
    expect(trips[0].distanceKm).toBeCloseTo(6.44, 2);
    expect(trips[0].startOdometerKm).toBe(Math.round(21500 * 1.609344));
  });

  it('rejects files that are not Journey Log exports', () => {
    expect(() => parseCsv('a,b,c\n1,2,3')).toThrow(JourneyLogFormatError);
    expect(() => parseCsv('')).toThrow(JourneyLogFormatError);
  });

  it('round-trips through the CSV writer', () => {
    const demo = generateDemoTrips({ endDate: new Date(2026, 5, 1), days: 60 });
    const { trips } = parseCsv(toJourneyLogCsv(demo));
    expect(trips).toHaveLength(demo.length);
    const byId = new Map(trips.map((t) => [t.id, t]));
    for (const original of demo) {
      const parsed = byId.get(original.id)!;
      expect(parsed.distanceKm).toBe(original.distanceKm);
      expect(parsed.socEnd).toBe(original.socEnd);
    }
  });
});

describe('parseXlsx', () => {
  it('reads shared strings and numeric cells', () => {
    const xlsx = buildXlsx([
      ['Start Date', 'End Date', 'Start Address', 'End Address', 'Distance in KM', 'Consumption in Kwh', 'Category', 'Start Odometer', 'SOC Source', 'SOC Destination'],
      ['2026-09-10, 15:04', '2026-09-10, 15:08', 'A & B', 'C', 4, 1.415, 'Private', 21500, 70, 68],
    ]);
    const { trips } = parseXlsx(xlsx);
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ startAddress: 'A & B', distanceKm: 4, energyKwh: 1.415, startOdometerKm: 21500, socStart: 70 });
  });

  it('reports broken files', () => {
    expect(() => parseXlsx(new Uint8Array([1, 2, 3]))).toThrow(JourneyLogFormatError);
  });
});

// Optional check against a real export kept outside the repository.
const realExport = process.env.JOURNEY_LOG_SAMPLE;
describe.skipIf(!realExport || !existsSync(realExport.replace(/\.csv$/, '.xlsx')))('real export', () => {
  it('parses CSV and XLSX identically', () => {
    const csv = parseCsv(readFileSync(realExport!, 'utf8'));
    const xlsx = parseXlsx(new Uint8Array(readFileSync(realExport!.replace(/\.csv$/, '.xlsx'))));
    expect(csv.trips.length).toBeGreaterThan(0);
    expect(xlsx.trips).toEqual(csv.trips);
  });
});
