import { personName } from '../../lib/personName.js';
import { useEvents } from '../../components/EventScope.jsx';
import FilterField from '../../components/FilterField.jsx';
import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../../api.js';
import { selectedEvent } from '../../event.js';
import EventTabs from '../../components/EventTabs.jsx';
import { formatRoom } from '../../lib/room.js';
import { fmtFull } from '../../lib/time.js';
import { reportingDates } from '../../lib/bimtekSchedule.js';
import { readMonitoringCsv } from '../../lib/reportingFiles.js';
import { SkelCards, Spinner } from '../../components/Skeleton.jsx';
import AttendanceDetailDialog from './AttendanceDetailDialog.jsx';
import WhatsAppLink from '../../components/WhatsAppLink.jsx';
import './Reporting.css';
import AttendanceRanking from './AttendanceRanking.jsx';
import { sortTableRows } from '../../lib/tableSort.js';
import { rankVenues } from '../../lib/venueRanking.js';

const labels = {
  belum_kirim: 'Belum kirim', menunggu_reviu: 'Menunggu reviu', ditolak: 'Ditolak',
  diterima: 'Diterima', sudah_direviu: 'Sudah direviu (hasil belum tersedia)', belum_ada_data: 'Belum ada data', sudah_absen: 'Sudah absen',
  belum_absen: 'Belum absen', sudah_tiba: 'Sudah tiba', sedang_antre: 'Sedang antre',
  bersedia_hadir: 'Bersedia hadir', belum_konfirmasi: 'Belum konfirmasi',
  berhalangan: 'Berhalangan', tidak_terdata: 'Tidak terdata',
};
const reportStatuses = ['belum_kirim', 'menunggu_reviu', 'ditolak', 'diterima', 'sudah_direviu', 'belum_ada_data'];
const datasetNames = new Proxy({ current: 'BIMTEK TAHAP 3', k3: 'BIMTEK TAHAP 2' }, {
  get(target, key) { return key === 'current' ? (selectedEvent()?.name || target.current).toUpperCase() : target[key]; },
});
const views = { schools: 'Sekolah', facilitators: 'Fasilitator', ranking: 'Peringkat LO', venues: 'Peringkat Venue', regions: 'Wilayah' };
const PAGE_SIZE = 10;
const UNASSIGNED = 'binaan-tidak-terpetakan';
const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const shortDate = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' });
const percent = (numerator, total) => total ? numerator * 100 / total : 0;
const submitted = (school) => school.status !== 'belum_kirim' && school.status !== 'belum_ada_data';
const ownerKey = ({ name, venue }) => JSON.stringify([venue, name]);
const nameKey = (name) => String(name || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const matches = (row, query) => row.some((value) => String(value ?? '').toLowerCase().includes(query));
const reportTag = (status) => <span className="reporting-tag" data-status={status}>{labels[status]}</span>;

function grouped(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function ReportingTable({ headers, rows, fullWidthColumn, pageSize = PAGE_SIZE }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ column: null, direction: 'asc' });
  const orderedRows = sortTableRows(rows, sort.column, sort.direction);
  const pages = Math.ceil(rows.length / pageSize);
  const active = Math.min(page, pages || 1);
  return (
    <>
      <div className="assignment-table-head">
        <span className="muted small">{nf.format(rows.length)} hasil</span>
        <span className="muted small">Klik judul kolom untuk mengurutkan naik/turun.</span>
        {pages > 1 && <nav className="pager assignment-pager" aria-label="Halaman pantau pelaporan">
          <button className="btn btn--sm" aria-label="Halaman sebelumnya" disabled={active === 1} onClick={() => setPage(active - 1)}>‹</button>
          <span className="small" aria-live="polite">Halaman {active} / {pages}</span>
          <button className="btn btn--sm" aria-label="Halaman berikutnya" disabled={active === pages} onClick={() => setPage(active + 1)}>›</button>
        </nav>}
      </div>
      {rows.length ? <div className="assignment-table">
        <table className="table stack-table" role="table" aria-label="Rincian pelaporan">
          <thead role="rowgroup"><tr role="row">{headers.map((heading, column) => <th key={heading} scope="col" role="columnheader"
            aria-sort={sort.column === column ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
            <button type="button" className="reporting-sort" onClick={() => {
              setSort((previous) => ({ column, direction: previous.column === column && previous.direction === 'asc' ? 'desc' : 'asc' }));
              setPage(1);
            }} aria-label={`Urutkan ${heading} ${sort.column === column && sort.direction === 'asc' ? 'menurun' : 'menaik'}`}>
              {heading} <span aria-hidden="true">{sort.column !== column ? '↕' : sort.direction === 'asc' ? '↑' : '↓'}</span>
            </button>
          </th>)}</tr></thead>
          <tbody role="rowgroup">{orderedRows.slice((active - 1) * pageSize, active * pageSize).map(({ key, cells, onOpen, name }) => (
            <tr key={key} role="row" className={onOpen ? 'reporting-clickable-row' : undefined}
              tabIndex={onOpen ? 0 : undefined} aria-label={onOpen ? `Lihat sekolah binaan ${personName(name)}` : undefined}
              onClick={onOpen ? (event) => { if (!event.target.closest('button,a,input,select,textarea')) onOpen(); } : undefined}
              onKeyDown={onOpen ? (event) => {
                if (event.target === event.currentTarget && ['Enter',' '].includes(event.key)) { event.preventDefault(); onOpen(); }
              } : undefined}>{cells.map((value, i) => (
              <td key={headers[i]} role="cell" className={headers[i] === fullWidthColumn ? 'stack-full' : undefined}
                data-label={i ? headers[i] : undefined}>{value ?? '—'}</td>
            ))}</tr>
          ))}</tbody>
        </table>
      </div> : <p className="card muted">Tidak ada data untuk filter ini.</p>}
    </>
  );
}

function ReportingRanking({ rows, movement, movementLabel, own }) {
  const maxMovement = Math.max(1, ...rows.map((row) => row.change));
  return <section className="reporting-ranking" aria-label="Daftar peringkat LO" tabIndex={0}>
    {rows.length ? <ol>
      {rows.map((row) => <li key={row.key}>
        <div className="reporting-ranking-name">
          <b>{row.rank}. {personName(row.name)}{own && ownerKey(own) === row.key && <span className="reporting-own">Anda</span>}</b>
          <strong>{movement ? `+${nf.format(row.change)}` : `${nf.format(row.ratio)}%`}</strong>
        </div>
        <progress aria-label={`${movement ? 'Pergerakan' : 'Capaian'} ${personName(row.name)}`}
          value={movement ? row.change : row.ratio} max={movement ? maxMovement : 100} />
        <p>{movement ? `${nf.format(row.change)} sekolah ${movementLabel.replace(/^Kirim/, 'kirim')} · ` : ''}
          Total {nf.format(row.sent)}/{nf.format(row.total)} sudah kirim · {row.venue}
        </p>
        {row.known < row.total && <small className="muted">
          Data monitoring tersedia untuk {nf.format(row.known)} dari {nf.format(row.total)} sekolah
        </small>}
      </li>)}
    </ol> : <p className="muted">Tidak ada LO yang cocok dengan filter.</p>}
  </section>;
}

function ReportingVenueRanking({ rows }) {
  return <section className="reporting-ranking" aria-label="Daftar peringkat venue" tabIndex={0}>
    {rows.length ? <ol>{rows.map((row) => <li key={row.name}>
      <div className="reporting-ranking-name"><b>{row.rank ?? '—'}. {row.name}</b>
        <strong>{row.known ? `${nf.format(row.ratio)}%` : 'Belum ada data'}</strong></div>
      {row.known > 0 && <progress aria-label={`Capaian ${row.name}`} value={row.ratio} max={100} />}
      <p>Total {nf.format(row.sent)}/{nf.format(row.total)} sudah kirim · {nf.format(row.accepted)} diterima · {nf.format(row.pending)} menunggu reviu</p>
      {row.known < row.total && <small className="muted">Data monitoring tersedia untuk {nf.format(row.known)} dari {nf.format(row.total)} sekolah</small>}
    </li>)}</ol> : <p className="muted">Tidak ada venue yang cocok dengan pencarian.</p>}
  </section>;
}

function ReportingComparison({ schools, baseline, stamp, archive = true }) {
  const before = schools.filter((school) => school.submitted_on && school.submitted_on < baseline).length;
  const final = schools.filter(submitted).length;
  const delta = final - before;
  return <div className="stats public-reporting-comparison">
    <article className="stat">
      <div className="stat__head"><h4>Sebelum acara dimulai</h4></div>
      <div className="stat__big">{nf.format(before)}<small> sekolah sudah kirim</small></div>
      <div className="muted small">Tanggal kirim sebelum {shortDate.format(new Date(baseline + 'T00:00:00+07:00'))}.</div>
    </article>
    <article className="stat">
      <div className="stat__head"><h4>Ringkasan akhir yang tersedia</h4></div>
      <div className="stat__big">{nf.format(final)}<small> sekolah sudah kirim</small></div>
      <small className="reporting-comparison-delta">{delta > 0 ? '+' : ''}{nf.format(delta)} sekolah sejak sebelum acara</small>
      <div className="muted small">{stamp ? archive ? `Arsip ${stamp}.` : `Data terakhir ${fmtFull(stamp)}.` : 'Belum ada data monitoring.'}</div>
    </article>
  </div>;
}

function ImportReporting({ onSaved }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [stage, setStage] = useState('reading');
  const [showResult, setShowResult] = useState(false);
  const dialog = useRef(null);
  useEffect(() => { if ((busy || showResult) && !dialog.current.open) dialog.current.showModal(); }, [busy, showResult]);
  async function save(e) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setFeedback(null);
    setShowResult(true); setStage('reading');
    try {
      // Beri browser kesempatan menampilkan dialog sebelum memproses file.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const csv = await readMonitoringCsv(file, setStage);
      setStage('saving');
      const result = await api('/admin/reporting/import', {
        admin: true, method: 'POST', body: { csv },
      });
      const { updated, skipped, contacts_updated: contacts, defaulted } = result;
      setStage('done');
      setFeedback({ result, message: `${nf.format(updated)} sekolah diperbarui.${defaulted ? ` ${nf.format(defaulted)} sekolah di luar CSV ditandai Belum kirim.` : ''}${skipped ? ` ${nf.format(skipped)} NPSN di luar pemetaan kegiatan ini dilewati.` : ''}${contacts ? ` ${nf.format(contacts)} kontak dilengkapi.` : ''}` });
      onSaved();
    } catch (e) {
      setFeedback({ error: true, message: e.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
    <dialog ref={dialog} className="assignment-dialog" aria-labelledby="report-import-title" aria-busy={busy}
      onCancel={(event) => { if (busy) event.preventDefault(); }} onClose={() => setShowResult(false)}>
      <header><h3 id="report-import-title">{busy ? 'Memproses impor pelaporan' : feedback?.error ? 'Impor belum selesai' : 'Impor selesai'}</h3></header>
      <p className="muted small">{file?.name}</p>
      {busy ? <div role="status" aria-live="polite">
        <div className="import-progress-status"><Spinner size={24} /><div>
          {stage === 'reading' ? 'Membaca file CSV…' : stage === 'validating' ? 'Mengenali format dan menyiapkan kolom laporan…' : 'Mencocokkan NPSN, memvalidasi, dan menyimpan ke server…'}
          <p>Mohon tunggu dan jangan tutup halaman. Hasil ditampilkan setelah server selesai.</p>
        </div></div>
        <progress aria-label="Impor laporan sedang diproses" />
        <ol className="import-stage-list">
          {[['reading', 'Baca file'], ['validating', 'Kenali format'], ['saving', 'Validasi & simpan']].map(([key, title], index) => {
            const activeIndex = ['reading', 'validating', 'saving'].indexOf(stage);
            return <li key={key} aria-current={stage === key ? 'step' : undefined}>{title} · {index < activeIndex ? 'Selesai' : index === activeIndex ? 'Sedang diproses' : 'Menunggu'}</li>;
          })}
        </ol>
      </div>
        : <><p className={feedback?.error ? 'alert alert--err' : 'alert alert--ok'} role="status">{feedback?.message}</p>
          {feedback?.result && <>
            <dl className="import-result-summary">
              <dt>Jenis laporan</dt><dd>{({ progress: 'Progres Laporan Sekolah', review: 'Monitoring status reviu', compact: 'Status ringkas' })[feedback.result.source] || 'Monitoring laporan'}</dd>
              <dt>Baris diperiksa</dt><dd>{nf.format(feedback.result.imported)}</dd>
              <dt>Sekolah diperbarui</dt><dd>{nf.format(feedback.result.updated)}</dd>
              <dt>Di luar pemetaan, dilewati</dt><dd>{nf.format(feedback.result.skipped)}</dd>
              <dt>Sekolah di luar CSV ditandai belum kirim</dt><dd>{nf.format(feedback.result.defaulted || 0)}</dd>
              <dt>Sekolah di luar CSV tetap</dt><dd>{nf.format(feedback.result.unchanged || 0)}</dd>
              <dt>Kontak dilengkapi</dt><dd>{nf.format(feedback.result.contacts_updated || 0)}</dd>
            </dl>
            {feedback.result.source !== 'progress' && <>
              <h4>Status sekolah yang diperbarui</h4>
              <dl className="import-result-summary">{['belum_kirim', 'menunggu_reviu', 'ditolak', 'diterima'].map((code) =>
                <div key={code} style={{ display: 'contents' }}><dt>{labels[code]}</dt><dd>{nf.format(feedback.result.status_counts?.[code] || 0)}</dd></div>)}</dl>
              <p className="muted small">Ringkasan ini mencakup sekolah yang diperbarui pada impor ini, termasuk sekolah yang ditandai Belum kirim dari berkas monitoring lengkap.</p>
            </>}
          </>}
          {feedback?.result?.source === 'progress' && <>
            <dl className="import-result-summary">
              <dt>Laporan 50% terkirim</dt><dd>{nf.format(feedback.result.sent)}</dd>
              <dt>Laporan 50% direviu</dt><dd>{nf.format(feedback.result.reviewed)}</dd>
              <dt>Capaian ≥50%, belum terkirim</dt><dd>{nf.format(feedback.result.ready)}</dd>
            </dl><p className="muted small">Hasil diterima/ditolak dan tanggal kirim sebelumnya tetap disimpan. Direviu tidak otomatis berarti diterima. Nama, kontak, penugasan, dan absensi tidak diubah.</p>
          </>}
          {feedback?.error && <p className="muted small">Periksa pesan di atas lalu pilih atau perbaiki file dan coba lagi. Jika koneksi terputus saat penyimpanan, muat ulang data pelaporan untuk memastikan hasilnya.</p>}
          <button type="button" className="btn btn--primary" onClick={() => dialog.current.close()}>Tutup</button>
        </>}
    </dialog>
    <details className="card reporting-import">
      <summary>Impor laporan terbaru · {datasetNames.current}</summary>
      <form className="form" onSubmit={save}>
        <p className="muted small">CSV <b>Progres Laporan Sekolah</b> juga didukung: memperbarui capaian fisik serta indikator laporan 50% terisi, terkirim, dan direviu. Hanya NPSN sekolah binaan diproses; sekolah di luar file, hasil reviu, dan tanggal kirim tidak ditimpa. Data NIK dan nomor kontak tidak dikirim dari format ini.</p>
        <p className="muted small">Unggah CSV Monitoring Laporan 50% lengkap untuk memperbarui status reviu, tanggal kirim, dan capaian fisik berdasarkan NPSN. Sekolah pemetaan kegiatan ini yang tidak tercantum ditandai Belum kirim. Nomor fasilitator dan pengawas ditambahkan jika identitasnya cocok dan profil belum memiliki nomor.</p>
        <p className="muted small">Format ringkas dengan kolom <code>npsn</code>, <code>status</code>, <code>tanggal_kirim</code> dan <code>progres_fisik</code> juga bisa dipakai.</p>
        <input type="file" accept=".csv,text/csv" aria-label="File CSV monitoring" disabled={busy} onChange={(e) => setFile(e.target.files[0])} />
        <p className="muted small">Gunakan file sumber terbaru. Sumber status dipilih berdasarkan waktu impor; mengunggah file lama dapat mengganti tampilan data yang lebih baru. Popup menampilkan tahap proses dan ringkasan hasil setelah penyimpanan selesai.</p>
        <button className="btn btn--primary" disabled={!file || busy}>{busy ? 'Menyimpan…' : 'Impor laporan terbaru'}</button>
        {feedback && <p className={feedback.error ? 'alert alert--err' : 'alert alert--ok'} role="status">{feedback.message}</p>}
      </form>
    </details>
    </>
  );
}

export function ReportingView({ data, dataset, account, canImport, refresh, publicView = false, stageTabs }) {
  const archiveMatches = dataset === 'k3' && account ? data.lo.filter((row) => nameKey(row.name) === nameKey(account.name)) : [];
  const own = data.own || (archiveMatches.length === 1 ? archiveMatches[0] : null);
  const accountVenue = data.venues.includes(account?.venue?.name) ? account.venue.name : '';
  const [view, setView] = useState('schools');
  const [progressScope, setProgressScope] = useState('all');
  const [venue, setVenue] = useState(own?.venue || accountVenue);
  const [lo, setLo] = useState(own ? ownerKey(own) : account ? UNASSIGNED : '');
  const [status, setStatus] = useState('');
  const [attendance, setAttendance] = useState('');
  const [checkInFilters, setCheckInFilters] = useState({});
  const [term, setTerm] = useState('');
  const [threshold, setThreshold] = useState(2);
  const [customBaseline, setCustomBaseline] = useState('');
  const baseline = customBaseline || data.baseline || '';
  const movementLabel = customBaseline && customBaseline !== data.baseline
    ? `Kirim sejak ${shortDate.format(new Date(customBaseline))}`
    : `Kirim sejak ${datasetNames[dataset]} dimulai`;
  const [movement, setMovement] = useState(true);
  const [attendanceRanking, setAttendanceRanking] = useState(false);
  const [selectedFacilitator, setSelectedFacilitator] = useState(null);
  const facilitatorDetail = useRef(null);
  useEffect(() => {
    if (selectedFacilitator && facilitatorDetail.current) {
      facilitatorDetail.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      facilitatorDetail.current.focus({ preventScroll: true });
    }
  }, [selectedFacilitator]);
  const [schoolDetails, setSchoolDetails] = useState(null);
  const query = term.trim().toLowerCase();
  const venueMatch = (row) => !venue || venue === row.venue;
  const scope = (row) => venueMatch(row) && (!lo || lo === ownerKey({ venue: row.venue, name: row.lo }));
  const schools = data.schools.filter(scope);
  const sentCount = schools.filter(submitted).length;
  const readyCount = schools.filter((school) => school.status === 'belum_kirim' && school.progress != null && school.progress >= 50).length;
  const belowThresholdCount = schools.filter((school) => school.status === 'belum_kirim' && (school.progress == null || school.progress < 50)).length;
  const byFacilitator = grouped(schools, (row) => row.facilitator_id);
  const byLo = grouped(data.schools, (row) => ownerKey({ name: row.lo, venue: row.venue }));
  const facilitators = new Map(data.facilitators.map((f) => [f.id, f]));
  const current = dataset === 'current' && selectedEvent()?.id!==2;
  const checkInDays = current ? data.check_in_days || [] : [];
  const checkInStatus = (school, day) => school.check_in_dates?.includes(day.date) ? 'sudah_absen' : 'belum_absen';
  const venueStatus = (school) => current ? school.venue_attendance || 'tidak_terdata' : school.attendance;
  const attendanceOptions = current ? ['sudah_tiba', 'sedang_antre', 'tidak_terdata']
    : ['sudah_tiba', 'sedang_antre', 'bersedia_hadir', 'belum_konfirmasi', 'berhalangan', 'tidak_terdata'];
  const present = schools.filter((s) => ['sudah_tiba', 'sedang_antre'].includes(venueStatus(s))).length;
  const waiting = schools.filter((s) => s.status === 'menunggu_reviu');
  const overdue = (rows) => rows.filter((s) => s.status === 'menunggu_reviu' && s.wait_days > threshold).length;
  const scopedFacilitators = data.facilitators.filter(scope);
  const problematicFacilitators = scopedFacilitators.filter((facilitator) =>
    overdue(byFacilitator.get(facilitator.id) || []) > 0).length;
  const counts = new Map([...grouped(schools, (s) => s.status)].map(([key, group]) => [key, group.length]));
  const hasReports = data.schools.some((s) => s.status !== 'belum_ada_data');
  const nextView = (key) => { setView(key); setTerm(''); setSelectedFacilitator(null); };

  const schoolRows = (list, search = '') => list
    .filter((s) => matches([s.name, s.npsn, s.city, s.province, facilitators.get(s.facilitator_id)?.name], search))
    .sort((a, b) => (b.wait_days ?? -1) - (a.wait_days ?? -1) || (a.rank || Infinity) - (b.rank || Infinity) || a.name.localeCompare(b.name, 'id'))
    .map((s) => ({ key: s.npsn,
      sortValues: [s.name, [s.venue, s.lo, formatRoom(s.room)].filter(Boolean).join(' '), facilitators.get(s.facilitator_id)?.name,
        labels[s.status], s.progress, labels[venueStatus(s)],
        ...(current ? checkInDays.map((day) => labels[checkInStatus(s, day)]) : [labels.tidak_terdata])],
      cells: [
      <>{current && !publicView ? <button type="button" className="reporting-school-link" aria-haspopup="dialog" onClick={() => setSchoolDetails({
        label: 'Bendahara dan Pengawas', subtitle: s.venue, path: `/admin/reporting/school/${s.npsn}`, checkInDays,
      })}>{s.name}</button> : <b>{s.name}</b>}
        <div className="muted small">NPSN {s.npsn} · {s.city || s.province || '—'}</div></>,
      <>{s.venue}<div className="muted small">{formatRoom(s.room)}{s.lo && ` · ${personName(s.lo)}`}</div></>,
      facilitators.has(s.facilitator_id) ? <>{personName(facilitators.get(s.facilitator_id).name)}
        <WhatsAppLink name={personName(facilitators.get(s.facilitator_id).name)} phone={facilitators.get(s.facilitator_id).phone} /></> : null,
      <>{reportTag(s.status)}{s.wait_days != null && <div className="muted small">{nf.format(s.wait_days)} hari</div>}</>,
      s.progress == null ? '—' : `${nf.format(s.progress)}%`, reportTag(venueStatus(s)),
      ...(current ? checkInDays.map((day) => reportTag(checkInStatus(s, day))) : [reportTag('tidak_terdata')]),
    ] }));
  const schoolHeaders = ['Sekolah', 'Venue / LO', 'Fasilitator', 'Laporan 50%', 'Progres fisik', 'Kehadiran di venue',
    ...(current ? checkInDays.map((day) => `${day.label} · ${day.shortDate}`) : ['Absensi'])];
  let headers = schoolHeaders;
  let rows = [];
  let ranking = [];
  if (view === 'schools') rows = schoolRows(schools.filter((s) => (!status || s.status === status)
    && (!attendance || venueStatus(s) === attendance)
    && checkInDays.every((day) => !checkInFilters[day.date] || checkInStatus(s, day) === checkInFilters[day.date])), query);
  if (view === 'facilitators') {
    headers = ['Fasilitator', 'Venue / LO', 'Sekolah', 'Belum kirim', 'Menunggu reviu', `Lewat ${threshold} hari`];
    rows = data.facilitators.filter((f) => scope(f) && matches([f.name, f.institution, f.coordinator, f.lo], query))
      .map((f) => {
        const group = byFacilitator.get(f.id) || [];
        const late = overdue(group);
        const pending = group.filter((s) => s.status === 'menunggu_reviu').length;
        const unsent = group.filter((s) => s.status === 'belum_kirim').length;
        return { key: f.id, late, pending, name: f.name, onOpen: () => setSelectedFacilitator({ ...f }),
          sortValues: [f.name, [f.venue, f.lo, formatRoom(f.room)].filter(Boolean).join(' '), group.length, unsent, pending, late], cells: [
          <><b>{personName(f.name)}</b><WhatsAppLink name={personName(f.name)} phone={f.phone} /><div className="muted small">{[f.institution, personName(f.coordinator)].filter(Boolean).join(' · ')}</div></>,
          <>{f.venue}<div className="muted small">{[formatRoom(f.room), personName(f.lo)].filter(Boolean).join(' · ')}</div></>,
          <button className="btn btn--sm" onClick={() => setSelectedFacilitator({ ...f })} aria-label={`Lihat sekolah ${personName(f.name)}`}>{group.length}</button>,
          unsent, pending, late,
        ] };
      }).sort((a, b) => b.late - a.late || b.pending - a.pending || a.name.localeCompare(b.name, 'id'));
  }
  if (view === 'ranking') {
    if (hasReports) ranking = data.lo.filter(venueMatch).map((owner) => {
      const group = byLo.get(ownerKey(owner)) || [];
      const sent = group.filter(submitted).length;
      const known = group.filter((s) => s.status !== 'belum_ada_data').length;
      const change = baseline ? group.filter((s) => submitted(s) && s.submitted_on && s.submitted_on >= baseline).length : 0;
      return { ...owner, total: group.length, sent, known, change, ratio: percent(sent, group.length) };
    }).filter((r) => r.known > 0).sort((a, b) =>
      (movement && baseline ? b.change - a.change : 0) || b.ratio - a.ratio || b.sent - a.sent || a.name.localeCompare(b.name, 'id'))
      .map((r, i) => ({ ...r, rank: i + 1, key: ownerKey(r) }))
      .filter((r) => matches([r.name], query) && (!publicView || !lo || ownerKey(r) === lo));
  }
  if (view === 'regions') {
    headers = ['Wilayah', 'Sekolah', ...reportStatuses.map((code) => labels[code])];
    rows = [...grouped(schools, (s) => [s.city, s.province].filter(Boolean).join(' · ') || 'Wilayah belum tersedia')]
      .filter(([region]) => matches([region], query))
      .sort(([a], [b]) => a.localeCompare(b, 'id'))
      .map(([region, group]) => {
        const counts = reportStatuses.map((code) => group.filter((s) => s.status === code).length);
        return { key: region, sortValues: [region, group.length, ...counts], cells: [<b>{region}</b>, group.length, ...counts] };
      });
  }
  const detail = selectedFacilitator && byFacilitator.get(selectedFacilitator.id);
  const selectedOwner = data.lo.find((owner) => ownerKey(owner) === lo);
  const noData = counts.get('belum_ada_data') || 0;
  const scopeTitle = selectedOwner?.name ? personName(selectedOwner.name)
    : lo === UNASSIGNED ? personName(account.name) : venue || 'Semua venue';
  const sourceNote = data.stamp ? `Data per ${dataset === 'k3' ? data.stamp : fmtFull(data.stamp)}` : 'Data belum tersedia';

  return (
    <>
      {publicView && <div className="toolbar filters reporting-scope reporting-scope--public">
        {stageTabs}
        <FilterField label="Cakupan progres"><select aria-label="Cakupan progres" value={progressScope} onChange={(event) => {
          const next = event.target.value;
          setProgressScope(next); setSelectedFacilitator(null);
          if (next === 'all') { setVenue(''); setLo(''); }
          if (next === 'venue') { setVenue(venue || data.venues[0] || ''); setLo(''); }
          if (next === 'lo') {
            const first = data.lo.find((owner) => owner.venue === venue) || data.lo[0];
            setVenue(first?.venue || ''); setLo(first ? ownerKey(first) : '');
          }
        }}>
          <option value="all">Progres seluruh venue</option>
          <option value="venue">Progres per venue</option>
          <option value="lo">Progres per LO</option>
        </select></FilterField>
        {progressScope !== 'all' && <FilterField label="Filter venue pelaporan"><select aria-label="Filter venue pelaporan" value={venue}
          onChange={(event) => {
            const nextVenue = event.target.value;
            setVenue(nextVenue); setSelectedFacilitator(null);
            if (progressScope === 'lo') {
              const first = data.lo.find((owner) => owner.venue === nextVenue);
              setLo(first ? ownerKey(first) : '');
            }
          }}>
          {data.venues.map((name) => <option key={name}>{name}</option>)}
        </select></FilterField>}
        {progressScope === 'lo' && <FilterField label="Filter LO pelaporan"><select aria-label="Filter LO pelaporan" value={lo} onChange={(event) => {
          setLo(event.target.value);
          setSelectedFacilitator(null);
        }}>
          {!data.lo.some(venueMatch) && <option value="">Belum ada LO di venue ini</option>}
          {data.lo.filter(venueMatch).map((owner) => <option key={ownerKey(owner)} value={ownerKey(owner)}>{personName(owner.name)}</option>)}
        </select></FilterField>}
      </div>}
      {(dataset === 'k3' || (current && selectedEvent()?.id === 3)) && data.baseline &&
        <ReportingComparison schools={schools} baseline={data.baseline} stamp={data.stamp} archive={dataset === 'k3'} />}
      <section className="reporting-hero" aria-label="Ringkasan pelaporan">
        <header className="reporting-hero-head">
          <div>
            <div className="reporting-eyebrow">{datasetNames[dataset]}{dataset === 'k3' || selectedEvent()?.id === 3 ? ` · ${reportingDates[dataset]}` : ''}{dataset === 'k3' && ' · Arsip'}</div>
            <h3>{scopeTitle}</h3>
            <p>{nf.format(schools.length)} sekolah{selectedOwner && ` · ${selectedOwner.venue}`}</p>
            {dataset === 'k3' && <p>{data.title}</p>}
          </div>
          {dataset === 'current' && !publicView && <button className="btn btn--sm" onClick={refresh}>Muat ulang</button>}
        </header>
        <div className="reporting-duo">
          <div><b>{nf.format(readyCount)}</b><span>Siap kirim, belum diajukan</span>
            <small>{nf.format(belowThresholdCount)} sekolah belum tercatat mencapai 50% fisik</small>
            {noData > 0 && <small>{nf.format(noData)} sekolah belum memiliki data monitoring</small>}</div>
          <div className="reporting-review-metric"><b>{nf.format(waiting.length)}</b><span>Menunggu reviu fasilitator</span>
            <small>{nf.format(overdue(waiting))} melewati {threshold} hari</small></div>
        </div>
        <div className="reporting-highlights">
          <div><b>{nf.format(sentCount + readyCount)}</b><small>Sudah kirim atau siap kirim</small>
            <small>{nf.format(sentCount)} sudah kirim + {nf.format(readyCount)} siap kirim, belum diajukan</small></div>
          <div><b>{nf.format(problematicFacilitators)} / {nf.format(scopedFacilitators.length)}</b>
            <small>Fasilitator dengan antrean lewat batas</small>
            <small>Minimal satu laporan menunggu reviu lebih dari {threshold} hari</small>
          </div>
          <div><b>{nf.format(present)} / {nf.format(schools.length)}</b><small>Sekolah hadir di venue ({nf.format(percent(present, schools.length))}%)</small>
            <small>Sudah tiba atau sedang antre</small>
          </div>
          <div className="reporting-accepted-metric"><b>{nf.format(counts.get('diterima') || 0)}</b><small>Laporan diterima</small></div>
        </div>
        {checkInDays.length > 0 && <div className="reporting-day-summary">
          {checkInDays.map((day) => <div key={day.date}>
            <small>{day.label} · {day.shortDate}</small>
            <b>{nf.format(schools.filter((s) => checkInStatus(s, day) === 'sudah_absen').length)}</b> sudah absen
          </div>)}
        </div>}
        <div className="reporting-source">{sourceNote}</div>
      </section>
      {canImport && <ImportReporting onSaved={refresh} />}
      {!publicView && <div className="toolbar filters reporting-scope">
        <FilterField label="Filter venue pelaporan"><select aria-label="Filter venue pelaporan" value={venue} onChange={(e) => { setVenue(e.target.value); setLo(''); setSelectedFacilitator(null); }}>
          <option value="">Semua venue</option>
          {data.venues.map((name) => <option key={name}>{name}</option>)}
        </select></FilterField>
        {view !== 'ranking' && <FilterField label="Filter LO pelaporan"><select aria-label="Filter LO pelaporan" value={lo} onChange={(e) => { setLo(e.target.value); setSelectedFacilitator(null); }}>
          <option value="">Semua LO</option>
          {account && !own && <option value={UNASSIGNED}>Binaan saya</option>}
          {data.lo.filter(venueMatch).map((owner) => <option key={ownerKey(owner)} value={ownerKey(owner)}>{personName(owner.name)}{!venue && ` · ${owner.venue}`}</option>)}
        </select></FilterField>}
      </div>}
      {lo === UNASSIGNED && <p className="alert alert--warn">Akun ini belum punya pemetaan LO yang cocok pada {datasetNames[dataset]}. Pilih Semua LO untuk melihat daftar lengkap.</p>}
      <h3 className="reporting-section-heading">Alur Laporan 50%</h3>
      <div className="reporting-summary" aria-label="Filter alur laporan 50%">
        {reportStatuses.filter((code) => dataset === 'current' || code !== 'belum_ada_data').map((code) => (
          <button key={code} type="button" data-status={code} aria-pressed={view === 'schools' && status === code}
            onClick={() => { nextView('schools'); setStatus(view === 'schools' && status === code ? '' : code); setAttendance(''); setCheckInFilters({}); }}>
            <span>{labels[code]}</span><b>{nf.format(counts.get(code) || 0)}</b>
          </button>
        ))}
      </div>
      <div className="assignment-tabs reporting-tabs" role="group" aria-label="Tampilan pantau pelaporan">
        {Object.entries(views).map(([key, label]) => <button key={key} className={view === key ? 'on' : ''} aria-pressed={view === key} onClick={() => nextView(key)}>{label}</button>)}
      </div>
      {view === 'ranking' && <div className="reporting-ranking-head">
        <h3>Peringkat LO</h3>
        {!attendanceRanking && <span className="muted small">{nf.format(ranking.length)} LO · {nf.format(new Set(ranking.map((row) => row.venue)).size)} venue</span>}
      </div>}
      {view === 'ranking' && <div className="reporting-ranking-tabs" role="group" aria-label="Urutan peringkat"
        style={{ gridTemplateColumns: `repeat(${current && !publicView ? 3 : 2}, minmax(0, 1fr))` }}>
        <button type="button" className={!attendanceRanking && movement ? 'on' : ''} aria-pressed={!attendanceRanking && movement} onClick={() => { setAttendanceRanking(false); setMovement(true); }}>Pergerakan</button>
        <button type="button" className={!attendanceRanking && !movement ? 'on' : ''} aria-pressed={!attendanceRanking && !movement} onClick={() => { setAttendanceRanking(false); setMovement(false); }}>Capaian</button>
        {current && !publicView && <button type="button" className={attendanceRanking ? 'on' : ''} aria-pressed={attendanceRanking} onClick={() => setAttendanceRanking(true)}>Absensi</button>}
      </div>}
      <div className={`toolbar filters${view === 'ranking' ? ' reporting-ranking-filters' : ''}`}>
        <FilterField label="Cari data pelaporan"><input type="search" aria-label="Cari data pelaporan" placeholder={view === 'ranking' ? 'Cari nama LO' : view === 'schools' ? 'Cari sekolah, NPSN, atau wilayah' : `Cari ${views[view].toLowerCase()}`}
          value={term} onChange={(e) => { setTerm(e.target.value); setSelectedFacilitator(null); }} /></FilterField>
        {view === 'schools' && <>
          <FilterField label="Status laporan"><select aria-label="Status laporan" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Semua status laporan</option>
            {reportStatuses.filter((code) => dataset === 'current' || code !== 'belum_ada_data').map((code) => <option key={code} value={code}>{labels[code]}</option>)}
          </select></FilterField>
          <FilterField label="Status kehadiran di venue"><select aria-label="Status kehadiran di venue" value={attendance} onChange={(e) => setAttendance(e.target.value)}>
            <option value="">Semua kehadiran di venue</option>
            {attendanceOptions.map((code) => <option key={code} value={code}>{labels[code]}</option>)}
          </select></FilterField>
          {checkInDays.map((day) => <FilterField label={`Status ${day.label}`} key={day.date}><select key={day.date} aria-label={`Status ${day.label}`}
            value={checkInFilters[day.date] || ''} onChange={(e) => setCheckInFilters({ ...checkInFilters, [day.date]: e.target.value })}>
            <option value="">{day.label} · Semua status</option>
            {['sudah_absen', 'belum_absen'].map((code) => <option key={code} value={code}>{labels[code]}</option>)}
          </select></FilterField>)}
        </>}
        {view === 'facilitators' && <FilterField label="Ambang tunggakan"><select aria-label="Ambang tunggakan" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
          {[1, 2, 3, 7].map((day) => <option key={day} value={day}>Lewat {day} hari</option>)}
        </select></FilterField>}
        {view === 'ranking' && !attendanceRanking && movement && <FilterField label="Tanggal acuan pergerakan kiriman"><input type="date" aria-label="Tanggal acuan pergerakan kiriman"
          value={baseline} onChange={(e) => setCustomBaseline(e.target.value)} /></FilterField>}
      </div>
      {view === 'ranking' && !attendanceRanking && <p className="muted small">Capaian dihitung dari laporan yang sudah dikirim dibanding seluruh sekolah binaan. LO tanpa data monitoring belum masuk peringkat.</p>}
      {view === 'venues' && <p className="muted small">Perbandingan seluruh venue pada tahap ini, tanpa filter venue atau LO. Urutan berdasarkan persentase sekolah yang sudah mengirim laporan; jika sama, persentase diterima lalu jumlah kiriman. Venue tanpa data monitoring belum masuk peringkat.</p>}
      {view === 'venues' ? <ReportingVenueRanking rows={rankVenues(data.schools, data.venues).filter((row) => matches([row.name], query))} /> : view === 'ranking' ? (attendanceRanking && current && !publicView ? <AttendanceRanking venue={venue} query={query} /> : <ReportingRanking rows={ranking} movement={movement} movementLabel={movementLabel} own={own} />)
        : <ReportingTable pageSize={publicView ? 5 : PAGE_SIZE} key={JSON.stringify([view, venue, lo, status, attendance, checkInFilters, term, threshold])}
          headers={headers} rows={rows} fullWidthColumn={current && view === 'schools' ? 'Kehadiran di venue' : undefined} />}
      {detail && <section ref={facilitatorDetail} tabIndex={-1} className="card reporting-detail" aria-label={`Sekolah binaan ${personName(selectedFacilitator.name)}`}>
        <div className="page-head"><h3>Sekolah binaan {personName(selectedFacilitator.name)}</h3>
          <button className="btn btn--sm" onClick={() => setSelectedFacilitator(null)}>Tutup rincian</button></div>
        <ReportingTable key={selectedFacilitator.id} headers={schoolHeaders} rows={schoolRows(detail)}
          fullWidthColumn={current ? 'Kehadiran di venue' : undefined} />
      </section>}
      <AttendanceDetailDialog details={schoolDetails} onClose={() => setSchoolDetails(null)} />
    </>
  );
}

export default function Reporting() {
  const { user, lo } = useOutletContext();
  const events = useEvents();
  const [dataset, setDataset] = useState('current');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => {
    let current = true;
    api(`/admin/reporting?dataset=${dataset}`, { admin: true })
      .then((next) => { if (current) { setData(next); setError(''); } })
      .catch((e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [dataset, revision]);
  return (
    <div className="reporting-page">
      <div className="page-head"><div><h2>Pantau Pelaporan</h2><p className="muted">Pantau Laporan 50%, antrean reviu, dan kehadiran sekolah.</p></div></div>
      <EventTabs current={dataset === 'current'} onSelect={() => { setDataset('current'); setData(null); setError(''); refresh(); }}>
        {!events?.events.some((event)=>event.id===2) && <button type="button" className={dataset === 'k3' ? 'on' : ''} aria-pressed={dataset === 'k3'}
          onClick={() => { if (dataset !== 'k3') { setDataset('k3'); setData(null); setError(''); } }}>BIMTEK Tahap 2</button>}
      </EventTabs>
      {error && <p className="alert alert--err" role="alert">{error} <button className="btn btn--sm" onClick={refresh}>Coba lagi</button></p>}
      {lo && (user.no_assignment || data?.no_assignment) && <p className="alert">Anda belum memiliki penugasan pada tahap ini. Ringkasan ditampilkan untuk dilihat; pencatatan absensi mengikuti tahap penugasan Anda.</p>}
      {!data && !error && <div className="kpis"><SkelCards n={3} h={76} /></div>}
      {data && <ReportingView key={`${dataset}:${lo ? 'lo' : 'admin'}`} data={data} dataset={dataset} refresh={refresh} account={lo && !user.no_assignment && !data.no_assignment ? user : null}
        canImport={dataset === 'current' && user?.role === 'admin' && !lo && selectedEvent()?.status !== 'archived'} />}
    </div>
  );
}
