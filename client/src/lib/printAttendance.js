import { personName } from './personName.js';
import { api, adminToken } from '../api.js';
import { eventPath } from '../event.js';
import { downloadFile } from './downloadFile.js';
import { attendanceFilename, loLabel } from './attendanceNaming.js';

const time = value => new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
const statuses = { valid: 'Valid', review: 'Perlu dicek', ditolak: 'Ditolak', berhalangan: 'Mundur/Berhalangan Hadir' };
const printable = value => String(value ?? '').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

async function photoForPdf(row) {
  const response = await fetch(`/api/admin${eventPath(`/photo/${row.id}?bytes=true`)}`, {
    headers: { Authorization: `Bearer ${adminToken.get()}` }, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Foto ${personName(row.name)} gagal dimuat. Silakan ulangi unduhan.`);
  const blob = await response.blob();
  if (blob.size > 6 * 1024 * 1024) throw new Error('Ukuran foto terlalu besar.');
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#FFFFFF'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL('image/jpeg', 0.78), ratio: canvas.width / canvas.height };
  } finally { bitmap.close(); }
}

export async function printAttendance({ filters, title, heading = 'Rekap Absensi', onProgress }) {
  const records = [], seen = new Set(); let total = 0;
  do {
    const params = new URLSearchParams({ ...filters, limit: '200', offset: String(records.length) });
    const page = await api(`/admin/attendance?${params}`, { admin: true }); total = page.total;
    if (page.rows.some(row => seen.has(row.id)) || (!page.rows.length && records.length < total)) {
      throw new Error('Data absensi berubah saat menyiapkan unduhan. Silakan coba lagi.');
    }
    page.rows.forEach(row => { seen.add(row.id); records.push(row); });
    onProgress?.(`mengambil data ${records.length}/${total}`);
  } while (records.length < total);
  if (!records.length) throw new Error('Tidak ada absensi yang cocok dengan filter untuk diunduh.');
  const collator = new Intl.Collator('id-ID', { sensitivity: 'base', numeric: true });
  records.sort((a, b) => collator.compare(a.venue_name || '', b.venue_name || '')
    || collator.compare(personName(a.name), personName(b.name)) || Number(a.id) - Number(b.id));
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: printable(heading), author: 'Dashboard LO' });
  const gap = 4, width = (277 - 3 * gap) / 4, lineHeight = 3.1, printed = time(Date.now());
  let y, cards = [], rowOnPage = 0;
  const overflow = [];
  const textLines = (value, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(bold ? 8 : 7);
    return pdf.splitTextToSize(printable(value), width - 6).map(text => ({ text, bold }));
  };
  const header = () => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.setTextColor(255);
    const headingLines = pdf.splitTextToSize(printable(heading), 269);
    const headerHeight = 7 + headingLines.length * 6;
    pdf.setFillColor(23, 59, 118); pdf.rect(10, 8, 277, headerHeight, 'F');
    pdf.text(headingLines, 14, 16.5);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(40, 59, 83);
    const scope = pdf.splitTextToSize(printable(title), 277);
    pdf.text(scope, 10, 13 + headerHeight); y = 16 + headerHeight + scope.length * 3.4;
    pdf.text(`${records.length} catatan absensi - Dibuat ${printed} WIB`, 10, y); y += 6;
  };
  header(); const cardHeight = (194 - y - gap) / 2;
  const flush = () => {
    if (!cards.length) return;
    const height = cardHeight;
    if (rowOnPage === 2) { pdf.addPage(); header(); rowOnPage = 0; }
    cards.forEach((card, index) => {
      const x = 10 + index * (width + gap); let top = y + 4;
      pdf.setDrawColor(209, 221, 235); pdf.setFillColor(248, 250, 254);
      pdf.roundedRect(x, y, width, height, 2, 2, 'FD');
      if (card.photo) {
        const availableHeight = Math.max(24, height - 12 - card.lines.length * lineHeight);
        const imageWidth = Math.min(width - 6, availableHeight * card.photo.ratio), imageHeight = imageWidth / card.photo.ratio;
        pdf.addImage(card.photo.data, 'JPEG', x + (width - imageWidth) / 2, top, imageWidth, imageHeight);
        top += imageHeight + 4;
      }
      card.lines.forEach(({ text, bold }) => {
        pdf.setTextColor(bold ? 23 : 50, bold ? 59 : 67, bold ? 118 : 87);
        pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(bold ? 8 : 7);
        pdf.text(text, x + 3, top); top += lineHeight;
      });
    });
    y += height + gap; rowOnPage++; cards = [];
  };
  for (const [index, row] of records.entries()) {
    onProgress?.(`menyiapkan PDF ${index + 1}/${records.length}`);
    const photo = row.has_photo ? await photoForPdf(row) : null;
    const lines = [ ...textLines(personName(row.name), true), ...textLines([row.code, loLabel(row.position)].filter(Boolean).join(' - ')),
      ...textLines(row.institution || '-'), ...textLines(`Venue: ${row.venue_name || '-'}`),
      ...textLines(`${time(row.created_at)} WIB - ${statuses[row.status] || row.status}`),
      ...(row.scanned_by ? textLines(`Dicatat oleh ${personName(row.scanned_by)}`) : []),
      ...(row.participant_note ? [...textLines(row.status === 'berhalangan' ? 'Alasan berhalangan hadir' : 'Catatan kendala', true), ...textLines(row.participant_note)] : []),
      ...(!photo ? textLines('Tidak ada foto') : []) ];
    const count = Math.max(2, Math.floor((cardHeight - (photo ? 28 : 0) - 8) / lineHeight));
    let part = lines;
    if (lines.length > count) {
      overflow.push({ name: personName(row.name), code: row.code, lines: lines.slice(count - 1) });
      part = [...lines.slice(0, count - 1), { text: `Rincian lanjutan: lampiran ${overflow.length}`, bold: true }];
    }
    cards.push({ photo, lines: part });
    if (cards.length === 4) flush();
    if (index % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  flush();
  // Keep eight distinct profiles on each full page without discarding long notes.
  for (const [index, entry] of overflow.entries()) {
    pdf.addPage(); header();
    const continuation = textLines(`Lampiran ${index + 1}: ${entry.name} (${entry.code || '-'})`, true);
    for (const line of [...continuation, ...entry.lines]) {
      if (y > 191) { pdf.addPage(); header(); }
      pdf.setFont('helvetica', line.bold ? 'bold' : 'normal'); pdf.setFontSize(line.bold ? 8 : 7);
      pdf.setTextColor(40, 59, 83); pdf.text(line.text, 10, y); y += lineHeight;
    }
  }
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(100);
    pdf.text(`Halaman ${page} / ${pages}`, 287, 202, { align: 'right' });
  }
  downloadFile(pdf.output('blob'), attendanceFilename(heading, 'pdf'));
}
