import { strFromU8, unzipSync } from 'fflate';

/**
 * Minimal reader for the first worksheet of an .xlsx file.
 *
 * The Journey Log export is a plain table of strings and numbers, so a small
 * regex based reader over the OOXML parts is enough and keeps the bundle free
 * of a full spreadsheet library.
 */
export type Cell = string | number | null;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity] ?? match;
  });
}

/** Concatenates all <t> runs inside an element (handles rich text). */
function textRuns(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function resolveFirstSheetPath(files: Record<string, Uint8Array>): string {
  const workbook = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : '';
  const rels = files['xl/_rels/workbook.xml.rels'] ? strFromU8(files['xl/_rels/workbook.xml.rels']) : '';
  const sheetRid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  if (sheetRid) {
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
      const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
      if (id === sheetRid && target) {
        const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
        if (files[path]) return path;
      }
    }
  }
  const fallback = Object.keys(files)
    .filter((p) => /^xl\/worksheets\/[^/]+\.xml$/.test(p))
    .sort()[0];
  if (!fallback) throw new Error('No worksheet found in the workbook.');
  return fallback;
}

export function readFirstSheet(data: Uint8Array): Cell[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new Error('The file is not a valid .xlsx workbook.');
  }
  const shared: string[] = [];
  if (files['xl/sharedStrings.xml']) {
    const xml = strFromU8(files['xl/sharedStrings.xml']);
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textRuns(m[1]));
  }
  const sheet = strFromU8(files[resolveFirstSheetPath(files)]);
  const rows: Cell[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: Cell[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const index = ref ? columnIndex(ref) : row.length;
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: Cell = null;
      if (type === 's') value = raw != null ? (shared[Number(raw)] ?? null) : null;
      else if (type === 'inlineStr') value = textRuns(body);
      else if (type === 'str' || type === 'e') value = raw != null ? decodeXml(raw) : null;
      else if (type === 'b') value = raw ?? null;
      else if (raw != null) value = Number(raw);
      while (row.length < index) row.push(null);
      row[index] = value;
    }
    rows.push(row);
  }
  return rows;
}
