export const CSV_BOM = '﻿';
export const CSV_SEPARATOR = ';';
export const CSV_NEWLINE = '\r\n';

const FORMULA_START = /^[\s ​﻿]*[=+\-@\t\r\n＝＋－＠]/;

export function formatCsvNumber(value, decimals = 2) {
  if (!Number.isFinite(value)) return '';
  const factor = 10 ** decimals;
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
  return String(Object.is(rounded, -0) ? 0 : rounded).replace('.', ',');
}

export function escapeCsvText(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (/[;"\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvCell(cell) {
  if (cell && typeof cell === 'object' && 'number' in cell) {
    const text = formatCsvNumber(cell.number, cell.decimals === undefined ? 2 : cell.decimals);
    return text;
  }
  if (typeof cell === 'number') return formatCsvNumber(cell);
  return escapeCsvText(cell);
}

export function toCsv(rows) {
  return CSV_BOM + rows.map((row) => row.map(csvCell).join(CSV_SEPARATOR)).join(CSV_NEWLINE) + CSV_NEWLINE;
}
