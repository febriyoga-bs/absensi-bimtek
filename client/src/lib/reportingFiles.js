const asText = (value) => String(value ?? '').trim();
const normalized = (value) => asText(value).toLowerCase();

function pickColumns(rows, required) {
  const [header, ...body] = rows;
  const keys = header?.map(normalized) || [];
  const columns = required.map((column) => keys.indexOf(column));
  if (columns.some((index) => index === -1)) {
    throw new Error(`Kolom wajib tidak ditemukan: ${required.filter((_, i) => columns[i] === -1).join(', ')}.`);
  }
  return body.map((row) => columns.map((index) => asText(row[index]))).filter((row) => row.some(Boolean));
}

export async function readMonitoringCsv(file) {
  if (file.size > 20_000_000) throw new Error('Ukuran CSV maksimal 20 MB.');
  const { default: Papa } = await import('papaparse');
  const text = await file.text();
  const { data, errors } = Papa.parse(text, { skipEmptyLines: 'greedy' });
  if (errors.length) throw new Error('CSV tidak bisa dibaca. Periksa pemisah kolom dan tanda kutip.');
  if (!data[0]?.map(normalized).includes('status reviu')) return text;
  const columns = ['npsn', 'status reviu', 'tanggal kirim', 'capaian saat ini (%)'];
  return Papa.unparse([columns, ...pickColumns(data, columns)]);
}

export async function readArrivalWorkbook(file) {
  if (file.size > 5_000_000) throw new Error('Ukuran Excel maksimal 5 MB.');
  const { readSheet } = await import('read-excel-file/browser');
  let rows;
  try { rows = await readSheet(file, 'Detail Peserta'); }
  catch { throw new Error('Excel tidak bisa dibaca. Pastikan file .xlsx memiliki sheet Detail Peserta.'); }
  return pickColumns(rows, ['regional / hotel', 'role', 'nama', 'instansi', 'kedatangan']);
}
