/**
 * LIFE DROP: SECURE CSV SERIALIZER (RFC 4180 COMPLIANT)
 *
 * Security features:
 * 1. CSV Formula Injection (DDE) Mitigation:
 *    Any cell string beginning with '=', '+', '-', '@', '\t', or '\r' is prefixed
 *    with a single quote (') to force spreadsheet software to treat it as a literal string.
 * 2. Proper RFC 4180 Escaping:
 *    Values containing commas, double-quotes, newlines, or carriage returns are quoted.
 *    Embedded double quotes are doubled (" -> "").
 * 3. Unicode Handling:
 *    Prepends UTF-8 Byte Order Mark (\uFEFF) to guarantee correct multi-language and
 *    accented character rendering across Excel, LibreOffice, and Google Sheets.
 */

export interface CsvColumn<T> {
  header: string;
  accessor: (row: T) => unknown;
}

/**
 * Sanitizes a cell value to prevent CSV formula injection (OWASP CSV Injection).
 */
export function sanitizeCsvCell(val: unknown): string {
  if (val === null || val === undefined) {
    return "";
  }

  let str = String(val);

  // Check for dangerous leading characters that could trigger formulas (including leading whitespace)
  if (/^\s*[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // If the cell contains quotes, commas, or newlines, quote the string
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Serializes an array of typed objects into an RFC 4180 compliant CSV string.
 */
export function serializeToCsv<T>(data: T[], columns: CsvColumn<T>[]): string {
  const headerLine = columns.map((col) => sanitizeCsvCell(col.header)).join(",");
  const rows = data.map((item) =>
    columns.map((col) => sanitizeCsvCell(col.accessor(item))).join(",")
  );

  // UTF-8 BOM prefix for seamless Excel Unicode compatibility
  const BOM = "\uFEFF";
  return BOM + [headerLine, ...rows].join("\r\n") + "\r\n";
}
