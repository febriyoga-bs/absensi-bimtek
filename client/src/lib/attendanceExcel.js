import { attendanceCell } from './attendanceNaming.js';
import { downloadFile } from './downloadFile.js';
import Papa from 'papaparse';

export async function downloadAttendanceExcel(csv, filename) {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const { data, errors } = Papa.parse(csv.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
  if (errors.length || !data.length) throw new Error('Data ekspor tidak dapat dibaca. Silakan coba lagi.');
  const [headers, ...body] = data;
  const rows = body.map((row) => headers.map((header, index) => {
    const value = String(row[index] ?? '');
    return attendanceCell(header, value);
  }));
  const widths = headers.map((header, column) => Math.min(header === 'URL Foto' ? 64 : 54,
    Math.max(14, ...[header, ...rows.map((row) => row[column])].map((value) =>
      Math.max(...value.split(/\r?\n/).map((line) => Math.ceil([...line].length * 1.1))) + 3))));
  const sheet = [headers.map((value) => ({ value, type: String, fontWeight: 'bold',
    backgroundColor: '#173B76', textColor: '#FFFFFF', height: 32, wrap: true, alignVertical: 'center' })),
  ...rows.map((row, index) => {
    const lines = Math.max(...row.map((value, col) => value.split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].length / (widths[col] - 3))), 0)));
    return row.map((value) => ({ value, type: String, format: '@', wrap: true, alignVertical: 'top',
      height: Math.min(409, Math.max(26, lines * 15 + 8)), backgroundColor: index % 2 ? '#EFF5FC' : '#FFFFFF',
      bottomBorderColor: '#DCE5F1', bottomBorderStyle: 'thin' }));
  })];
  const blob = await writeExcelFile(sheet, { sheet: 'Rekap Absensi', columns: widths.map((width) => ({ width })),
    stickyRowsCount: 1, stickyColumnsCount: 1, showGridLines: false, orientation: 'landscape' },
  { fontFamily: 'Calibri', fontSize: 11 }).toBlob();
  downloadFile(blob, filename);
}
