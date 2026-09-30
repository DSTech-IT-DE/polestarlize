/** Parsing helpers for single cell values of a Journey Log export. */

const pad = (n: number) => String(n).padStart(2, '0');

function formatLocal(y: number, m: number, d: number, hh: number, mm: number): string | null {
  const date = new Date(y, m - 1, d, hh, mm);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d || hh > 23 || mm > 59) {
    return null;
  }
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}`;
}

/** Converts an Excel serial date number (1900 date system) to local `YYYY-MM-DDTHH:mm`. */
export function excelSerialToLocal(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const utc = new Date(ms);
  return formatLocal(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate(), utc.getUTCHours(), utc.getUTCMinutes());
}

const ISO_LIKE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[,\sT]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?\s*$/;
const DOTTED = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::\d{2})?)?\s*$/;
const SLASHED = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?\s*$/i;

/**
 * Parses the date formats seen in exports. The Journey Log app writes
 * `YYYY-MM-DD, HH:mm`; the other forms are accepted for files that were
 * re-saved by a spreadsheet program.
 */
export function parseLocalDate(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'number') return excelSerialToLocal(value);
  const text = String(value).trim();
  if (!text) return null;
  let m = ISO_LIKE.exec(text);
  if (m) return formatLocal(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
  m = DOTTED.exec(text);
  if (m) return formatLocal(+m[3], +m[2], +m[1], +(m[4] ?? 0), +(m[5] ?? 0));
  m = SLASHED.exec(text);
  if (m) {
    let hh = +(m[4] ?? 0);
    const ampm = m[6]?.toUpperCase();
    if (ampm === 'PM' && hh < 12) hh += 12;
    if (ampm === 'AM' && hh === 12) hh = 0;
    // Month-first is what US spreadsheets write; fall back to day-first when that is impossible.
    return formatLocal(+m[3], +m[1], +m[2], hh, +(m[5] ?? 0)) ?? formatLocal(+m[3], +m[2], +m[1], hh, +(m[5] ?? 0));
  }
  if (/^\d+(\.\d+)?$/.test(text)) return excelSerialToLocal(Number(text));
  return null;
}

/** Parses a number that may use a comma as decimal separator. Returns null for empty or invalid input. */
export function parseNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value).trim().replace(/\s/g, '');
  if (!text) return null;
  if (text.includes(',') && !text.includes('.')) {
    text = text.replace(',', '.');
  } else if (text.includes(',') && text.includes('.')) {
    // "1,234.5" or "1.234,5": the last separator is the decimal one.
    text = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function parseText(value: unknown): string {
  return value == null ? '' : String(value).trim();
}
