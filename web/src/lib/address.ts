/**
 * Journey Log addresses look like "Street 14, 32369 Town-District, Germany":
 * the last segment is the country, the one before holds postal code and town.
 * US style ("Main St 1, Springfield, IL 62704, United States") puts the state
 * and ZIP code into that segment, so the town moves one segment to the left.
 */
export interface ParsedAddress {
  street: string;
  postalCode: string;
  town: string;
  country: string;
}

// Postal code in front of the town: 12345, 123 45 (SE/CZ), 1234 AB (NL), 1234 (AT/CH/NO/DK).
const POSTAL_PREFIX = /^(?:\d{3}\s\d{2}|\d{4}\s?[A-Z]{2}|\d{4,5}(?:-\d{4})?)\s+/;
// UK/CA style postal code behind the town: "London SW1A 2AA".
const POSTAL_SUFFIX = /\s+[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$|\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d$/;
// "IL 62704" or "CA 94016".
const US_STATE_ZIP = /^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/;

/** Splits a locality segment like "32369 Rahden-Wehe" into postal code and town. */
export function splitLocality(segment: string): { postalCode: string; town: string } {
  const text = segment.trim();
  const prefix = POSTAL_PREFIX.exec(text);
  if (prefix) return { postalCode: prefix[0].trim(), town: text.slice(prefix[0].length).trim() };
  const suffix = POSTAL_SUFFIX.exec(text);
  if (suffix) return { postalCode: suffix[0].trim(), town: text.slice(0, suffix.index).trim() };
  return { postalCode: '', town: text };
}

export function parseAddress(address: string): ParsedAddress {
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { street: '', postalCode: '', town: '', country: '' };
  if (parts.length === 1) return { street: parts[0], postalCode: '', town: '', country: '' };
  if (parts.length === 2) {
    // "Town, Country" or "12345 Town, Country".
    const { postalCode, town } = splitLocality(parts[0]);
    return { street: '', postalCode, town, country: parts[1] };
  }
  const country = parts[parts.length - 1];
  const locality = parts[parts.length - 2];
  const us = US_STATE_ZIP.exec(locality);
  if (us && parts.length >= 4) {
    return { street: parts.slice(0, -3).join(', '), postalCode: us[2], town: parts[parts.length - 3], country };
  }
  const { postalCode, town } = splitLocality(locality);
  return { street: parts.slice(0, -2).join(', '), postalCode, town, country };
}

/** "Street 1, 12345 Town, Country" → "Street 1, Town". */
export function shortAddress(address: string): string {
  const { street, town } = parseAddress(address);
  if (!street && !town) return address.trim() || '–';
  return [street, town].filter(Boolean).join(', ');
}
