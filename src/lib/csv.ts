/**
 * Small RFC 4180 CSV reader and writer (no dependency). Cells are plain strings: nothing
 * read from a file is ever evaluated, and every exported cell is formula-safe.
 */

export const CSV_MAX_BYTES = 5 * 1024 * 1024;
export const CSV_MAX_ROWS = 5000;
export const CSV_MAX_COLUMNS = 100;
export const CSV_MAX_CELL = 5000;

export type CsvParseResult = { ok: true; headers: string[]; rows: string[][] } | { ok: false; error: "empty" | "too_many_rows" | "too_many_columns" | "unterminated_quote" | "cell_too_long" | "no_header" | "duplicate_headers" };

/** Picks the delimiter that splits the header line into the most columns (comma, semicolon or tab). */
export function detectDelimiter(text: string): string {
  const line = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  let best = ",", bestCount = 0;
  for (const candidate of [",", ";", "\t"]) {
    let count = 0, quoted = false;
    for (const char of line) { if (char === "\"") quoted = !quoted; else if (char === candidate && !quoted) count++; }
    if (count > bestCount) { best = candidate; bestCount = count; }
  }
  return best;
}

/** Parses CSV text into records. Quoted cells may contain delimiters, quotes ("") and line breaks. */
export function parseCsvRecords(input: string, delimiter = detectDelimiter(input)): string[][] | "unterminated_quote" {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let record: string[] = [], cell = "", quoted = false, i = 0, cellStarted = false;
  while (i < text.length) {
    const char = text[i];
    if (quoted) {
      if (char === "\"") {
        if (text[i + 1] === "\"") { cell += "\""; i += 2; continue; }
        quoted = false; i++; continue;
      }
      cell += char; i++; continue;
    }
    if (char === "\"" && !cellStarted) { quoted = true; cellStarted = true; i++; continue; }
    if (char === delimiter) { record.push(cell); cell = ""; cellStarted = false; i++; continue; }
    if (char === "\r" || char === "\n") {
      record.push(cell); records.push(record); record = []; cell = ""; cellStarted = false;
      i += char === "\r" && text[i + 1] === "\n" ? 2 : 1; continue;
    }
    cell += char; cellStarted = true; i++;
  }
  if (quoted) return "unterminated_quote";
  if (cellStarted || cell || record.length) { record.push(cell); records.push(record); }
  // Drop blank lines (a lone empty cell) anywhere, including the trailing newline.
  return records.filter((row) => !(row.length === 1 && row[0].trim() === ""));
}

/** Header row plus data rows, padded or trimmed to the header width, within the import limits. */
export function parseCsv(input: string): CsvParseResult {
  const records = parseCsvRecords(input);
  if (records === "unterminated_quote") return { ok: false, error: "unterminated_quote" };
  if (!records.length) return { ok: false, error: "empty" };
  const headers = records[0].map((header) => header.trim());
  if (!headers.some(Boolean)) return { ok: false, error: "no_header" };
  if (headers.length > CSV_MAX_COLUMNS) return { ok: false, error: "too_many_columns" };
  const seen = new Set<string>();
  for (const header of headers.map((value) => value.toLowerCase()).filter(Boolean)) { if (seen.has(header)) return { ok: false, error: "duplicate_headers" }; seen.add(header); }
  const rows = records.slice(1).map((row) => headers.map((_, index) => row[index] ?? ""));
  if (!rows.length) return { ok: false, error: "empty" };
  if (rows.length > CSV_MAX_ROWS) return { ok: false, error: "too_many_rows" };
  if (rows.some((row) => row.some((value) => value.length > CSV_MAX_CELL))) return { ok: false, error: "cell_too_long" };
  return { ok: true, headers: headers.map((header, index) => header || `Column ${index + 1}`), rows };
}

const RISKY = /^(?:[\t\r]|[\s\p{White_Space}]*[=+\-@＝＋－＠])/u;
/**
 * Neutralizes spreadsheet formulas: a cell starting with a formula marker (possibly after whitespace), tab or CR gets a leading
 * single quote, which spreadsheet apps display as text (OWASP CSV injection guidance).
 */
export function formulaSafe(value: string): string {
  return RISKY.test(value) ? `'${value}` : value;
}
/** Undo formulaSafe on import, so a Harvest export round-trips; other leading quotes are kept. */
export function stripFormulaGuard(value: string): string {
  return value.length > 1 && value[0] === "'" && RISKY.test(value.slice(1)) ? value.slice(1) : value;
}
/** One CSV cell: formula-safe, quoted when it holds a delimiter, quote or line break. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  const text = formulaSafe(value === null || value === undefined ? "" : String(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}
export function csvLine(cells: (string | number | boolean | null | undefined)[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}
/** UTF-8 byte-order mark so spreadsheet apps read accented names correctly. */
export const CSV_BOM = "﻿";
