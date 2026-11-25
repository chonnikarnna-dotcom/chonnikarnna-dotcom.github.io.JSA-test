import ExcelJS from 'exceljs';
import { Response } from 'express';

export type Column = { key: string; header: string; width?: number };

/** Neutralize spreadsheet formula injection (=, +, -, @, tab, CR at cell start). */
export function safeCell(v: unknown): string | number {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv(cols: Column[], rows: Record<string, unknown>[]) {
  const esc = (v: unknown) => {
    const s = String(safeCell(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map((c) => esc(c.header)).join(','), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(','))];
  return '﻿' + lines.join('\r\n'); // BOM so Excel opens Thai text as UTF-8
}

export async function sendExport(res: Response, format: 'csv' | 'xlsx', filename: string, sheet: string, cols: Column[], rows: Record<string, unknown>[]) {
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(toCsv(cols, rows));
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'JSA System';
  const ws = wb.addWorksheet(sheet.slice(0, 31));
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 20 }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) ws.addRow(Object.fromEntries(cols.map((c) => [c.key, safeCell(r[c.key])])));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}
