import { api, adminUrl } from '../api.js';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const time = (value) => new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
const statuses = { valid: 'Valid', review: 'Perlu dicek', ditolak: 'Ditolak', berhalangan: 'Mundur/Berhalangan Hadir' };

export async function printAttendance({ filters, title, onProgress }) {
  // Open during the click so the browser does not block the report window.
  const report = window.open('', '_blank');
  if (!report) throw new Error('Jendela ekspor diblokir. Izinkan popup untuk web ini, lalu coba lagi.');
  report.opener = null;
  report.document.title = 'Menyiapkan PDF absensi';
  report.document.body.textContent = 'Mengumpulkan seluruh hasil absensi sesuai filter…';
  try {
    const records = [];
    const seen = new Set();
    let total = 0;
    do {
      if (report.closed) throw new Error('Jendela ekspor ditutup.');
      const params = new URLSearchParams({ ...filters, limit: '200', offset: String(records.length) });
      const page = await api(`/admin/attendance?${params}`, { admin: true });
      total = page.total;
      if (page.rows.some((row) => seen.has(row.id))) throw new Error('Data absensi berubah saat ekspor. Silakan coba lagi.');
      page.rows.forEach((row) => { seen.add(row.id); records.push(row); });
      onProgress?.(`${records.length}/${total}`);
      if (!page.rows.length && records.length < total) throw new Error('Data absensi berubah saat ekspor. Silakan coba lagi.');
    } while (records.length < total);
    if (!records.length) throw new Error('Tidak ada absensi yang cocok dengan filter untuk diekspor.');
    report.document.open();
    report.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Rekap Absensi BIMTEK</title>
      <style>
      *{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#172c47;margin:24px}h1{font-size:21px;margin:0 0 8px}
      header{margin-bottom:20px}header p{margin:5px 0}.tools{padding:14px;background:#eef3fa;margin-bottom:18px}
      button{padding:10px 18px;cursor:pointer}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      article{border:1px solid #ccd6e3;border-radius:8px;overflow:hidden;break-inside:avoid;min-width:0}
      article img{display:block;width:100%;height:210px;object-fit:contain;background:#101826}.body{padding:12px}
      h2{font-size:14px;margin:0 0 8px}p{margin:5px 0;overflow-wrap:anywhere}.note{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f4f8;padding:9px}
      @page{size:A4;margin:12mm}@media print{body{margin:0;font-size:9pt}.tools{display:none}.cards{gap:5mm}article img{height:55mm}article{border-radius:2mm}h2{font-size:11pt}}
      </style></head><body><div class="tools"><button id="print" disabled>Cetak / Simpan sebagai PDF</button>
      <p id="ready">Memuat foto…</p></div><header><h1>Rekap Absensi BIMTEK Revitalisasi SD</h1>
      <p>${escape(title)}</p><p>${records.length} catatan absensi · Dicetak ${escape(time(Date.now()))} WIB</p></header>
      <div class="cards">${records.map((row) => `<article>${row.has_photo
        ? `<img src="${escape(row.photo_url || adminUrl(`/photo/${row.id}`))}" alt="Foto ${escape(row.name)}">`
        : '<p class="body">Tidak ada foto</p>'}<div class="body"><h2>${escape(row.name)}</h2>
        <p>${escape([row.code, row.position].filter(Boolean).join(' · '))}</p>
        <p>${escape(row.institution || '-')}</p><p>Venue: ${escape(row.venue_name || '-')}</p>
        <p>${escape(time(row.created_at))} WIB · ${escape(statuses[row.status] || row.status)}</p>
        ${row.scanned_by ? `<p>Dicatat oleh ${escape(row.scanned_by)}</p>` : ''}
        ${row.participant_note ? `<p><b>Catatan kendala</b></p><div class="note">${escape(row.participant_note)}</div>` : ''}
        </div></article>`).join('')}</div></body></html>`);
    report.document.close();
    const images = [...report.document.images];
    await Promise.all(images.map((img) => new Promise((resolve) => {
      if (img.complete) return resolve();
      img.onload = resolve; img.onerror = resolve;
      setTimeout(resolve, 30000);
    })));
    if (report.closed) return;
    const missing = images.filter((img) => !img.complete || !img.naturalWidth).length;
    const ready = report.document.getElementById('ready');
    ready.textContent = missing
      ? `${missing} foto gagal dimuat. Tutup jendela ini dan ulangi ekspor agar PDF lengkap.`
      : 'Siap. Klik tombol, lalu pilih Simpan sebagai PDF pada tujuan cetak.';
    const button = report.document.getElementById('print');
    button.disabled = missing > 0;
    button.addEventListener('click', () => report.print());
  } catch (error) {
    if (!report.closed) report.document.body.textContent = error.message;
    throw error;
  }
}
