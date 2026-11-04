/**
 * CSV for spreadsheets (RFC 4180): every field quoted, lines ending CRLF, and a byte-order mark so Excel reads
 * UTF-8 (names like "Brücke" stay whole).
 *
 * A field starting with =, +, -, @, a tab or a carriage return gets a leading apostrophe: a spreadsheet would
 * otherwise run it as a formula (CSV injection), and client records hold text that outsiders typed.
 */
const FORMULA = /^[=+\-@\t\r]/

export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""'
  const text = typeof value === 'number' ? String(value) : FORMULA.test(value) ? `'${value}` : value
  return `"${text.replace(/"/g, '""')}"`
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return '﻿' + [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}
