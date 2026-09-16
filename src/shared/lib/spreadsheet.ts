/**
 * Spreadsheet export/import, in one place.
 *
 * Four screens each repeated the same json_to_sheet -> book_new -> book_append_sheet ->
 * writeFile sequence, and each one separately had to remember that `xlsx` must be imported
 * dynamically (it is ~490 kB — a third of the JS bundle — and is only ever needed once a
 * user actually clicks Export). Centralising it means a screen asks for "these rows, under
 * these sheet names, as this file" and cannot get the loading strategy wrong.
 */

export interface SheetSpec {
  /** Tab name inside the workbook. Excel caps these at 31 characters. */
  name: string;
  rows: Record<string, unknown>[];
  /** Per-column widths in characters, positional. Omit to let the reader auto-size. */
  columnWidths?: number[];
}

// Excel refuses to open a workbook whose sheet name exceeds 31 chars or contains []:*?/\
const EXCEL_SHEET_NAME_LIMIT = 31;
const ILLEGAL_SHEET_CHARS = /[[\]:*?/\\]/g;

export function toSafeSheetName(name: string): string {
  const cleaned = name.replace(ILLEGAL_SHEET_CHARS, '-').trim() || 'Sheet1';
  return cleaned.slice(0, EXCEL_SHEET_NAME_LIMIT);
}

// Same character restrictions apply to the download filename on Windows.
export function toSafeFileName(name: string): string {
  return (name.replace(ILLEGAL_SHEET_CHARS, '-').replace(/\s+/g, '_').trim() || 'export') + '.xlsx';
}

/**
 * Writes one or more sheets to a .xlsx and triggers the browser download.
 * `fileName` is given WITHOUT the extension — this adds it and sanitises the rest.
 */
export async function exportSheets(fileName: string, sheets: SheetSpec[]): Promise<void> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows);
    if (sheet.columnWidths?.length) {
      worksheet['!cols'] = sheet.columnWidths.map((wch) => ({ wch }));
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, toSafeSheetName(sheet.name));
  }

  XLSX.writeFile(workbook, toSafeFileName(fileName));
}

/** Convenience for the common single-sheet case. */
export function exportSheet(fileName: string, sheetName: string, rows: Record<string, unknown>[]): Promise<void> {
  return exportSheets(fileName, [{ name: sheetName, rows }]);
}

/** Parses the first sheet of an uploaded workbook into plain row objects. */
export async function readFirstSheetRows<T = Record<string, unknown>>(data: unknown): Promise<T[]> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(data, { type: 'binary' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName]) as T[];
}
