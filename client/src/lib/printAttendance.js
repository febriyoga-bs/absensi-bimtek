import { preparePdfResume, cachedPdfPhoto, prepareVenuePdfBatch } from './pdfResume.js';
import { attendancePdfGroups, attendancePdfCategorySummary, attendancePdfSections } from './attendancePdfGroups.js';
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
  if (!response.ok) {
    const error = new Error(`Foto ${personName(row.name)} gagal dimuat. Klik Lanjutkan PDF untuk mencoba kembali; foto yang sudah berhasil tetap tersimpan selama dialog ini terbuka.`);
    error.retryable = ![401,403,404].includes(response.status);
    throw error;
  }
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

export async function printAttendance({ filters, title, heading = 'Rekap Absensi', onProgress, resumeState = {}, outputOnly = false }) {
  const key = `${adminToken.get()}:${eventPath('/admin/attendance')}:${JSON.stringify(Object.entries(filters).sort(([a],[b])=>a.localeCompare(b)))}`;
  const state = preparePdfResume(resumeState, key);
  const records = state.records, seen = new Set(records.map(row => row.id)); let total = records.length;
  if (!state.dataComplete) do {
    const params = new URLSearchParams({ ...filters, limit: '200', offset: String(records.length) });
    const page = await api(`/admin/attendance?${params}`, { admin: true }); total = page.total;
    if (page.rows.some(row => seen.has(row.id)) || (!page.rows.length && records.length < total)) {
      throw new Error('Data absensi berubah saat menyiapkan unduhan. Silakan coba lagi.');
    }
    page.rows.forEach(row => { seen.add(row.id); records.push(row); });
    onProgress?.(`mengambil data ${records.length}/${total}`);
  } while (records.length < total);
  state.dataComplete = true;
  if (state.photos.size) onProgress?.(`melanjutkan dengan ${state.photos.size} foto yang sudah siap`);
  if (!records.length) throw Object.assign(new Error('Tidak ada absensi yang cocok dengan filter untuk diunduh.'), { code: 'NO_RECORDS' });
  const collator = new Intl.Collator('id-ID', { sensitivity: 'base', numeric: true });
  records.sort((a, b) => collator.compare(a.venue_name || '', b.venue_name || '')
    || collator.compare(personName(a.name), personName(b.name)) || Number(a.id) - Number(b.id));
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: printable(heading), author: 'Dashboard LO' });
  const gap = 4, width = (277 - 3 * gap) / 4, lineHeight = 3.1, printed = time(Date.now());
  let y, cards = [], rowOnPage = 0, sectionTitle = 'Ringkasan Absensi';
  const groups = attendancePdfGroups(records);
  const uniquePeople = rows => new Set(rows.map(row => row.person_id ?? row.code ?? row.id)).size;
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
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.text(sectionTitle, 10, y); y += 6;
  };
  header(); const cardHeight = (194 - y - gap) / 2;
  const summaryRows = [
    ['Total orang pada hasil filter', uniquePeople(records)],
    ...groups.map(group => [group.label, uniquePeople(group.rows)]),
    ['Total catatan absensi', records.length],
  ];
  let summaryY = y + 5;
  for (const [index, [label, value]] of summaryRows.entries()) {
    pdf.setFillColor(...(index % 2 ? [255,255,255] : [239,244,251]));
    pdf.rect(10, summaryY, 277, 9, 'F');
    pdf.setTextColor(40,59,83); pdf.setFontSize(11); pdf.setFont('helvetica','normal');
    pdf.text(label,15,summaryY+6); pdf.setFont('helvetica','bold');
    pdf.text(String(value),280,summaryY+6,{align:'right'}); summaryY += 9;
  }
  summaryY += 7;
  pdf.setFont('helvetica','bold'); pdf.setFontSize(10); pdf.text('Rincian per kategori (orang)',10,summaryY); summaryY += 4;
  const categoryRows = attendancePdfCategorySummary(records);
  const columns = [15,155,199,241,280];
  const drawCategoryRow = (values, isHeader, index) => {
    pdf.setFillColor(...(isHeader ? [23,59,118] : index % 2 ? [255,255,255] : [239,244,251]));
    pdf.rect(10,summaryY,277,8,'F');
    pdf.setTextColor(...(isHeader ? [255,255,255] : [40,59,83]));
    pdf.setFont('helvetica',isHeader?'bold':'normal'); pdf.setFontSize(9);
    values.forEach((value,i)=>pdf.text(String(value),columns[i],summaryY+5.4,{align:i?'right':'left'}));
    summaryY += 8;
  };
  drawCategoryRow(['Kategori','Hadir','Berhalangan','Ditolak / Lain','Total'],true,0);
  categoryRows.forEach((row,index)=>drawCategoryRow([row.label,row.hadir,row.berhalangan,row.lainnya,row.total],false,index));
  pdf.setTextColor(40,59,83);
  pdf.setFont('helvetica','normal'); pdf.setFontSize(8);
  pdf.text(pdf.splitTextToSize('Ringkasan mengikuti filter unduhan. Hadir mencakup status Valid dan Perlu dicek. Jumlah orang dihitung unik pada setiap bagian; satu orang dapat memiliki beberapa catatan sesi.',277),10,summaryY+10);

  const flush = () => {
    if (!cards.length) return;
    const height = cardHeight;
    if (rowOnPage === 2) { pdf.addPage(); header(); rowOnPage = 0; }
    cards.forEach((card, index) => {
      const x = 10 + index * (width + gap); let top = y + 4;
      pdf.setDrawColor(209, 221, 235); pdf.setFillColor(248, 250, 254);
      pdf.roundedRect(x, y, width, height, 2, 2, 'FD');
      const photoHeight = height * 0.5;
      const photoWidth = width - 6;
      pdf.setFillColor(235, 240, 247);
      pdf.rect(x + 3, top, photoWidth, photoHeight, 'F');
      if (card.photo) {
        const imageWidth = Math.min(photoWidth, photoHeight * card.photo.ratio);
        const imageHeight = imageWidth / card.photo.ratio;
        pdf.addImage(card.photo.data, 'JPEG', x + (width - imageWidth) / 2,
          top + (photoHeight - imageHeight) / 2, imageWidth, imageHeight);
      } else {
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(100);
        pdf.text('Tidak ada foto', x + width / 2, top + photoHeight / 2, { align: 'center' });
      }
      top += photoHeight + 4;
      card.lines.forEach(({ text, bold }) => {
        pdf.setTextColor(bold ? 23 : 50, bold ? 59 : 67, bold ? 118 : 87);
        pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(bold ? 8 : 7);
        pdf.text(text, x + 3, top); top += lineHeight;
      });
    });
    y += height + gap; rowOnPage++; cards = [];
  };
  let processed = 0;
  for (const group of attendancePdfSections(records)) {
    sectionTitle = `${group.label} - ${uniquePeople(group.rows)} orang / ${group.rows.length} catatan`;
    pdf.addPage(); header(); rowOnPage = 0;
    for (const [index, row] of group.rows.entries()) {
    onProgress?.(`menyiapkan PDF ${++processed}/${records.length}`);
    let photo = null;
    if (row.has_photo) {
      try {
        photo = await cachedPdfPhoto(state, String(row.id), () => photoForPdf(row), {
          onRetry: attempt => onProgress?.(`mencoba ulang foto ${personName(row.name)} (${attempt}/3); ${state.photos.size} foto sudah siap`),
        });
      } catch (error) {
        throw new Error(`Foto ${personName(row.name)} gagal dimuat. ${state.photos.size} foto sudah siap. Klik Lanjutkan PDF tanpa menutup dialog untuk melanjutkan.`);
      }
    }
    const lines = [ ...textLines(personName(row.name), true), ...textLines([row.code, loLabel(row.position)].filter(Boolean).join(' - ')),
      ...textLines(row.institution || '-'), ...textLines(`Venue: ${row.venue_name || '-'}`),
      ...textLines(`${time(row.created_at)} WIB - ${statuses[row.status] || row.status}`),
      ...(row.scanned_by ? textLines(`Dicatat oleh ${personName(row.scanned_by)}`) : []),
      ...(row.participant_note ? [...textLines(row.status === 'berhalangan' ? 'Alasan berhalangan hadir' : 'Catatan kendala', true), ...textLines(row.participant_note)] : []),
      ];
    const count = Math.max(2, Math.floor((cardHeight * 0.5 - 12) / lineHeight));
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
  }
  sectionTitle = 'Lampiran Rincian Lanjutan';
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
  const result = pdf.output('blob');
  if (!outputOnly) downloadFile(result, attendanceFilename(heading, 'pdf'));
  state.photos.clear(); state.records = []; state.dataComplete = false;
  return result;
}

export async function printAttendanceByVenue({ filters, venues, sessionName, titleForVenue, onProgress, resumeState = {} }) {
  const key = `${adminToken.get()}:${eventPath('/admin/attendance')}:${JSON.stringify(Object.entries(filters).sort(([a],[b])=>a.localeCompare(b)))}:${JSON.stringify(venues.map(v=>[v.id,v.name]))}`;
  const state = prepareVenuePdfBatch(resumeState, key);
  for (const [index, venue] of venues.entries()) {
    const id = String(venue.id);
    if (state.completedVenues.has(id) || state.emptyVenues.has(id)) continue;
    const heading = `${venue.name} - ${sessionName}`;
    try {
      const blob = await printAttendance({ filters: {...filters,venue_id:id},
        title: titleForVenue(venue.name), heading, outputOnly:true, resumeState:state.currentVenue,
        onProgress: progress=>onProgress?.(`${index+1}/${venues.length} venue - ${venue.name}: ${progress}`),
      });
      state.completedVenues.set(id,{name:attendanceFilename(heading,'pdf'),blob});
    } catch (error) {
      if (error.code === 'NO_RECORDS') { state.emptyVenues.add(id); continue; }
      throw error;
    }
  }
  if (!state.completedVenues.size) throw new Error('Tidak ada absensi yang cocok dengan filter untuk diunduh.');
  onProgress?.(`mengemas ${state.completedVenues.size} PDF per venue ke ZIP`);
  const {zip} = await import('fflate');
  const files = {};
  for (const [id,file] of state.completedVenues) {
    // Venue IDs disambiguate filenames only if two venue names sanitize identically.
    const name = Object.hasOwn(files,file.name) ? file.name.replace(/\.pdf$/,` (${id}).pdf`) : file.name;
    files[name] = [new Uint8Array(await file.blob.arrayBuffer()),{level:0}];
  }
  const bytes = await new Promise((resolve,reject)=>zip(files,{level:0},(error,data)=>error?reject(error):resolve(data)));
  downloadFile(new Blob([bytes],{type:'application/zip'}),attendanceFilename(`Semua Venue - ${sessionName}`,'zip'));
  state.completedVenues.clear(); state.emptyVenues.clear(); state.currentVenue = {};
}
