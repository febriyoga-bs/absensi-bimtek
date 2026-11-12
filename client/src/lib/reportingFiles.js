const asText = (value) => String(value ?? '').trim();
const normalized = (value) => asText(value).toLowerCase();

function pickColumns(rows, required, optional = []) {
  const [header, ...body] = rows;
  const keys = header?.map(normalized) || [];
  const columns = required.map((column) => keys.indexOf(column));
  if (columns.some((index) => index === -1)) {
    throw new Error(`Kolom wajib tidak ditemukan: ${required.filter((_, i) => columns[i] === -1).join(', ')}.`);
  }
  const indices = [...columns, ...optional.map((column) => keys.indexOf(column))];
  return body.map((row) => indices.map((index) => asText(row[index]))).filter((row) => row.some(Boolean));
}

export async function readMonitoringCsv(file) {
  if (file.size > 20_000_000) throw new Error('Ukuran CSV maksimal 20 MB.');
  const { default: Papa } = await import('papaparse');
  const text = await file.text();
  const { data, errors } = Papa.parse(text, { skipEmptyLines: 'greedy' });
  if (errors.length) throw new Error('CSV tidak bisa dibaca. Periksa pemisah kolom dan tanda kutip.');
  const names=data[0]?.map(normalized) || [];
  if (names.includes('l8 capaian 50% terkirim')) {
    const required=['npsn','capaian (%)','l7 capaian 50% terisi','l8 capaian 50% terkirim','r6 capaian 50% direviu'];
    if(required.some(name=>!names.includes(name))) throw new Error('Kolom CSV Progres Laporan Sekolah tidak lengkap.');
    const selected=required.map(name=>names.indexOf(name));
    return Papa.unparse(data.map(row=>selected.map(index=>asText(row[index]))));
  }
  if (!data[0]?.map(normalized).includes('status reviu')) return text;
  const columns = ['npsn', 'status reviu', 'tanggal kirim', 'capaian saat ini (%)'];
  const contacts = ['fasilitator', 'no. hp fasilitator', 'pengawas', 'no. hp pengawas'];
  return Papa.unparse([[...columns, ...contacts], ...pickColumns(data, columns, contacts)]);
}

export async function readArrivalWorkbook(file) {
  if (file.size > 5_000_000) throw new Error('Ukuran Excel maksimal 5 MB.');
  const { readSheet } = await import('read-excel-file/browser');
  let rows;
  try { rows = await readSheet(file, 'Detail Peserta'); }
  catch { throw new Error('Excel tidak bisa dibaca. Pastikan file .xlsx memiliki sheet Detail Peserta.'); }
  const details = pickColumns(rows, ['regional / hotel', 'role', 'nama', 'instansi', 'kedatangan']);
  let summaryRows;
  try { summaryRows = await readSheet(file, 'Ringkasan'); }
  catch { throw new Error('Sheet Ringkasan diperlukan sebagai acuan jumlah undangan dan pengawas terdaftar.'); }
  const summary = [];
  let position = null;
  for (const row of summaryRows) {
    const section = asText(row[0]);
    if (['Sekolah', 'Dinas Pendidikan', 'Pengawas'].includes(section)) {
      position = section === 'Sekolah' ? 'Bendahara' : section;
      continue;
    }
    if (!position || typeof row[0] !== 'number' || !asText(row[1])) continue;
    const count = (value) => Number.parseInt(String(value ?? '').replace(/\./g, ''), 10);
    summary.push({ hotel: asText(row[1]), position, invited: count(row[2]), arrived: count(row[7]), queued: count(row[8]) });
  }
  if (!summary.length) throw new Error('Rincian peran pada sheet Ringkasan tidak ditemukan.');
  return { rows: details, summary };
}
