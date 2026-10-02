import { describe, expect, it } from 'vitest';
import { parseAddress, shortAddress } from './address';

describe('parseAddress', () => {
  it('parses German style addresses', () => {
    expect(parseAddress('Hauptstraße 14, 10115 Musterstadt-Nord, Germany')).toEqual({
      street: 'Hauptstraße 14',
      postalCode: '10115',
      town: 'Musterstadt-Nord',
      country: 'Germany',
    });
  });

  it('handles Swedish, Dutch, Swiss and Norwegian postal codes', () => {
    expect(parseAddress('Vasagatan 12, 411 24 Göteborg, Sweden').town).toBe('Göteborg');
    expect(parseAddress('Damrak 1, 1012 LG Amsterdam, Netherlands').town).toBe('Amsterdam');
    expect(parseAddress('Bahnhofstrasse 1, 8001 Zürich, Switzerland').town).toBe('Zürich');
    expect(parseAddress('Karl Johans gate 1, 0154 Oslo, Norway').town).toBe('Oslo');
  });

  it('handles postal codes behind the town (UK) and US state + ZIP', () => {
    expect(parseAddress('10 Downing Street, London SW1A 2AA, United Kingdom')).toMatchObject({ town: 'London', postalCode: 'SW1A 2AA' });
    expect(parseAddress('1 Main St, Springfield, IL 62704, United States')).toMatchObject({
      street: '1 Main St',
      town: 'Springfield',
      postalCode: '62704',
    });
  });

  it('is tolerant of short and empty input', () => {
    expect(parseAddress('')).toMatchObject({ town: '', country: '' });
    expect(parseAddress('Somewhere')).toMatchObject({ street: 'Somewhere', town: '' });
    expect(parseAddress('12345 Town, Germany')).toMatchObject({ town: 'Town', country: 'Germany' });
  });
});

describe('shortAddress', () => {
  it('drops postal code and country', () => {
    expect(shortAddress('Hauptstraße 14, 10115 Musterstadt, Germany')).toBe('Hauptstraße 14, Musterstadt');
  });
  it('returns the input when it cannot be split and a dash when empty', () => {
    expect(shortAddress('Somewhere')).toBe('Somewhere');
    expect(shortAddress('')).toBe('–');
  });
});
