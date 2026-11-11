import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../../api.js';
import { formatRoom } from '../../lib/room.js';
import { fmtFull } from '../../lib/time.js';
import { readMonitoringCsv } from '../../lib/reportingFiles.js';
import { SkelCards } from '../../components/Skeleton.jsx';
import AttendanceDetailDialog from './AttendanceDetailDialog.jsx';
import WhatsAppLink from '../../components/WhatsAppLink.jsx';
import './Reporting.css';

const labels = {
  belum_kirim: 'Belum kirim', menunggu_reviu: 'Menunggu reviu', ditolak: 'Ditolak',
  diterima: 'Diterima', belum_ada_data: 'Belum ada data', sudah_absen: 'Sudah absen',
  belum_absen: 'Belum absen', sudah_tiba: 'Sudah tiba', sedang_antre: 'Sedang antre',
  bersedia_hadir: 'Bersedia hadir', belum_konfirmasi: 'Belum konfirmasi',
  berhalangan: 'Berhalangan', tidak_terdata: 'Tidak terdata',
};
const reportStatuses = ['belum_kirim', 'menunggu_reviu', 'ditolak', 'diterima', 'belum_ada_data'];
const datasetNames = { current: 'BIMTEK TAHAP 3', k3: 'BIMTEK TAHAP 2' };
const views = { schools: 'Sekolah', facilitators: 'Fasilitator', ranking: 'Peringkat LO', regions: 'Wilayah' };
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

function ReportingTable({ headers, rows, fullWidthColumn }) {
  const [page, setPage] = useState(1);
  const pages = Math.ceil(rows.length / PAGE_SIZE);
  const active = Math.min(page, pages || 1);
  return (
    <>
      <div className="assignment-table-head">
        <span className="muted small">{nf.format(rows.length)} hasil</span>
        {pages > 1 && <nav className="pager assignment-pager" aria-label="Halaman pantau pelaporan">
          <button className="btn btn--sm" aria-label="Halaman sebelumnya" disabled={active === 1} onClick={() => setPage(active - 1)}>‹</button>
          <span className="small" aria-live="polite">Halaman {active} / {pages}</span>
          <button className="btn btn--sm" aria-label="Halaman berikutnya" disabled={active === pages} onClick={() => setPage(active + 1)}>›</button>
        </nav>}
      </div>
      {rows.length ? <div className="assignment-table">
        <table className="table stack-table" role="table" aria-label="Rincian pelaporan">
          <thead role="rowgroup"><tr role="row">{headers.map((heading) => <th key={heading} scope="col" role="columnheader">{heading}</th>)}</tr></thead>
          <tbody role="rowgroup">{rows.slice((active - 1) * PAGE_SIZE, active * PAGE_SIZE).map(({ key, cells }) => (
            <tr key={key} role="row">{cells.map((value, i) => (
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
          <b>{row.rank}. {row.name}{own && ownerKey(own) === row.key && <span className="reporting-own">Anda</span>}</b>
          <strong>{movement ? `+${nf.format(row.change)}` : `${nf.format(row.ratio)}%`}</strong>
        </div>
        <progress aria-label={`${movement ? 'Pergerakan' : 'Capaian'} ${row.name}`}
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

function ReportingComparison({ schools, baseline, stamp }) {
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
      <div className="muted small">Arsip {stamp}.</div>
    </article>
  </div>;
}

function ImportReporting({ onSaved }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  async function save(e) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const { updated, skipped, contacts_updated: contacts } = await api('/admin/reporting/import', {
        admin: true, method: 'POST', body: { csv: await readMonitoringCsv(file) },
      });
      setFeedback({ message: `${nf.format(updated)} status sekolah disimpan.${skipped ? ` ${nf.format(skipped)} NPSN di luar pemetaan Tahap 3 dilewati.` : ''}${contacts ? ` ${nf.format(contacts)} kontak dilengkapi.` : ''}` });
      onSaved();
    } catch (e) {
      setFeedback({ error: true, message: e.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="card reporting-import">
      <summary>Impor status BIMTEK TAHAP 3</summary>
      <form className="form" onSubmit={save}>
        <p className="muted small">Unggah CSV Monitoring Laporan 50% untuk memperbarui status reviu, tanggal kirim, dan capaian fisik berdasarkan NPSN. Nomor fasilitator dan pengawas ditambahkan jika identitasnya cocok dan profil belum memiliki nomor.</p>
        <p className="muted small">Format ringkas dengan kolom <code>npsn</code>, <code>status</code>, <code>tanggal_kirim</code> dan <code>progres_fisik</code> juga bisa dipakai.</p>
        <input type="file" accept=".csv,text/csv" aria-label="File CSV monitoring" disabled={busy} onChange={(e) => setFile(e.target.files[0])} />
        <button className="btn btn--primary" disabled={!file || busy}>{busy ? 'Menyimpan…' : 'Simpan status dari CSV'}</button>
        {feedback && <p className={feedback.error ? 'alert alert--err' : 'alert alert--ok'} role="status">{feedback.message}</p>}
      </form>
    </details>
  );
}

export function ReportingView({ data, dataset, account, canImport, refresh, publicView = false }) {
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
  const [selectedFacilitator, setSelectedFacilitator] = useState(null);
  const [schoolDetails, setSchoolDetails] = useState(null);
  const query = term.trim().toLowerCase();
  const venueMatch = (row) => !venue || venue === row.venue;
  const scope = (row) => venueMatch(row) && (!lo || lo === ownerKey({ venue: row.venue, name: row.lo }));
  const schools = data.schools.filter(scope);
  const byFacilitator = grouped(schools, (row) => row.facilitator_id);
  const byLo = grouped(data.schools, (row) => ownerKey({ name: row.lo, venue: row.venue }));
  const facilitators = new Map(data.facilitators.map((f) => [f.id, f]));
  const current = dataset === 'current';
  const checkInDays = current ? data.check_in_days || [] : [];
  const checkInStatus = (school, day) => school.check_in_dates?.includes(day.date) ? 'sudah_absen' : 'belum_absen';
  const venueStatus = (school) => current ? school.venue_attendance || 'tidak_terdata' : school.attendance;
  const attendanceOptions = current ? ['sudah_tiba', 'sedang_antre', 'tidak_terdata']
    : ['sudah_tiba', 'sedang_antre', 'bersedia_hadir', 'belum_konfirmasi', 'berhalangan', 'tidak_terdata'];
  const present = schools.filter((s) => ['sudah_tiba', 'sedang_antre'].includes(venueStatus(s))).length;
  const waiting = schools.filter((s) => s.status === 'menunggu_reviu');
  const overdue = (rows) => rows.filter((s) => s.status === 'menunggu_reviu' && s.wait_days > threshold).length;
  const counts = new Map([...grouped(schools, (s) => s.status)].map(([key, group]) => [key, group.length]));
  const hasReports = data.schools.some((s) => s.status !== 'belum_ada_data');
  const nextView = (key) => { setView(key); setTerm(''); setSelectedFacilitator(null); };

  const schoolRows = (list, search = '') => list
    .filter((s) => matches([s.name, s.npsn, s.city, s.province, facilitators.get(s.facilitator_id)?.name], search))
    .sort((a, b) => (b.wait_days ?? -1) - (a.wait_days ?? -1) || (a.rank || Infinity) - (b.rank || Infinity) || a.name.localeCompare(b.name, 'id'))
    .map((s) => ({ key: s.npsn, cells: [
      <>{current && !publicView ? <button type="button" className="reporting-school-link" aria-haspopup="dialog" onClick={() => setSchoolDetails({
        label: 'Bendahara dan Pengawas', subtitle: s.venue, path: `/admin/reporting/school/${s.npsn}`, checkInDays,
      })}>{s.name}</button> : <b>{s.name}</b>}
        <div className="muted small">NPSN {s.npsn} · {s.city || s.province || '—'}</div></>,
      <>{s.venue}<div className="muted small">{formatRoom(s.room)}{s.lo && ` · ${s.lo}`}</div></>,
      facilitators.has(s.facilitator_id) ? <>{facilitators.get(s.facilitator_id).name}
        <WhatsAppLink name={facilitators.get(s.facilitator_id).name} phone={facilitators.get(s.facilitator_id).phone} /></> : null,
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
        return { key: f.id, late, pending, name: f.name, cells: [
          <><b>{f.name}</b><WhatsAppLink name={f.name} phone={f.phone} /><div className="muted small">{[f.institution, f.coordinator].filter(Boolean).join(' · ')}</div></>,
          <>{f.venue}<div className="muted small">{[formatRoom(f.room), f.lo].filter(Boolean).join(' · ')}</div></>,
          <button className="btn btn--sm" onClick={() => setSelectedFacilitator(f)} aria-label={`Lihat sekolah ${f.name}`}>{group.length}</button>,
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
    headers = ['Wilayah', 'Sekolah', 'Belum kirim', 'Menunggu reviu', 'Ditolak', 'Diterima', 'Belum ada data'];
    rows = [...grouped(schools, (s) => [s.city, s.province].filter(Boolean).join(' · ') || 'Wilayah belum tersedia')]
      .filter(([region]) => matches([region], query))
      .sort(([a], [b]) => a.localeCompare(b, 'id'))
      .map(([region, group]) => ({ key: region, cells: [<b>{region}</b>, group.length, ...reportStatuses.map((code) => group.filter((s) => s.status === code).length)] }));
  }
  const detail = selectedFacilitator && byFacilitator.get(selectedFacilitator.id);
  const selectedOwner = data.lo.find((owner) => ownerKey(owner) === lo);
  const noData = counts.get('belum_ada_data') || 0;
  const scopeTitle = selectedOwner?.name || (lo === UNASSIGNED ? account.name : venue || 'Semua venue');
  const sourceNote = dataset === 'k3'
    ? `Laporan 50% per ${data.stamp} · Kehadiran per ${data.attendance_stamp} · Arsip hanya memuat data kedatangan`
    : [
      data.stamp ? `Impor monitoring ${fmtFull(data.stamp)}` : 'Monitoring belum diimpor',
      data.arrival_stamp ? `Impor kehadiran terbaru ${fmtFull(data.arrival_stamp)}` : 'Rekap kehadiran belum diimpor',
      'Absensi Bendahara dari sesi resmi berdasarkan tanggal WIB',
    ].join(' · ');

  return (
    <>
      {publicView && <div className="toolbar filters reporting-scope">
        <select aria-label="Cakupan progres" value={progressScope} onChange={(event) => {
          const next = event.target.value;
          setProgressScope(next); setSelectedFacilitator(null);
          if (next === 'all') { setVenue(''); setLo(''); }
          if (next === 'venue') { setVenue(data.venues[0] || ''); setLo(''); }
          if (next === 'lo') {
            const first = data.lo[0];
            setVenue(first?.venue || ''); setLo(first ? ownerKey(first) : '');
          }
        }}>
          <option value="all">Progres seluruh venue</option>
          <option value="venue">Progres per venue</option>
          <option value="lo">Progres per LO</option>
        </select>
        {progressScope === 'venue' && <select aria-label="Filter venue pelaporan" value={venue}
          onChange={(event) => { setVenue(event.target.value); setSelectedFacilitator(null); }}>
          {data.venues.map((name) => <option key={name}>{name}</option>)}
        </select>}
        {progressScope === 'lo' && <select aria-label="Filter LO pelaporan" value={lo} onChange={(event) => {
          setLo(event.target.value);
          setVenue(data.lo.find((owner) => ownerKey(owner) === event.target.value)?.venue || '');
          setSelectedFacilitator(null);
        }}>
          {data.lo.map((owner) => <option key={ownerKey(owner)} value={ownerKey(owner)}>{owner.name} · {owner.venue}</option>)}
        </select>}
      </div>}
      {dataset === 'k3' && <ReportingComparison schools={schools} baseline={data.baseline} stamp={data.stamp} />}
      <section className="reporting-hero" aria-label="Ringkasan pelaporan">
        <header className="reporting-hero-head">
          <div>
            <div className="reporting-eyebrow">{datasetNames[dataset]}{dataset === 'k3' && ' · Arsip'}</div>
            <h3>{scopeTitle}</h3>
            <p>{nf.format(schools.length)} sekolah{selectedOwner && ` · ${selectedOwner.venue}`}</p>
            {dataset === 'k3' && <p>{data.title}</p>}
          </div>
          {dataset === 'current' && !publicView && <button className="btn btn--sm" onClick={refresh}>Muat ulang</button>}
        </header>
        <div className="reporting-duo">
          <div><b>{nf.format(counts.get('belum_kirim') || 0)}</b><span>Belum kirim Laporan 50%</span>
            {noData > 0 && <small>{nf.format(noData)} sekolah belum memiliki data monitoring</small>}</div>
          <div><b>{nf.format(waiting.length)}</b><span>Menunggu reviu fasilitator</span>
            <small>{nf.format(overdue(waiting))} melewati {threshold} hari</small></div>
        </div>
        <div className="reporting-highlights">
          <div><b>{nf.format(schools.filter(submitted).length)}</b><small>Sudah kirim</small></div>
          <div><b>{nf.format(present)}</b><small>Sudah tiba atau sedang antre</small></div>
          <div><b>{nf.format(counts.get('diterima') || 0)}</b><small>Laporan diterima</small></div>
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
        <select aria-label="Filter venue pelaporan" value={venue} onChange={(e) => { setVenue(e.target.value); setLo(''); setSelectedFacilitator(null); }}>
          <option value="">Semua venue</option>
          {data.venues.map((name) => <option key={name}>{name}</option>)}
        </select>
        {view !== 'ranking' && <select aria-label="Filter LO pelaporan" value={lo} onChange={(e) => { setLo(e.target.value); setSelectedFacilitator(null); }}>
          <option value="">Semua LO</option>
          {account && !own && <option value={UNASSIGNED}>Binaan saya</option>}
          {data.lo.filter(venueMatch).map((owner) => <option key={ownerKey(owner)} value={ownerKey(owner)}>{owner.name}{!venue && ` · ${owner.venue}`}</option>)}
        </select>}
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
        <span className="muted small">{nf.format(ranking.length)} LO · {nf.format(new Set(ranking.map((row) => row.venue)).size)} venue</span>
      </div>}
      {view === 'ranking' && <div className="reporting-ranking-tabs" role="group" aria-label="Urutan peringkat">
        <button type="button" className={movement ? 'on' : ''} aria-pressed={movement} onClick={() => setMovement(true)}>Pergerakan</button>
        <button type="button" className={!movement ? 'on' : ''} aria-pressed={!movement} onClick={() => setMovement(false)}>Capaian</button>
      </div>}
      <div className={`toolbar filters${view === 'ranking' ? ' reporting-ranking-filters' : ''}`}>
        <input type="search" aria-label="Cari data pelaporan" placeholder={view === 'ranking' ? 'Cari nama LO' : view === 'schools' ? 'Cari sekolah, NPSN, atau wilayah' : `Cari ${views[view].toLowerCase()}`}
          value={term} onChange={(e) => { setTerm(e.target.value); setSelectedFacilitator(null); }} />
        {view === 'schools' && <>
          <select aria-label="Status laporan" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Semua status laporan</option>
            {reportStatuses.filter((code) => dataset === 'current' || code !== 'belum_ada_data').map((code) => <option key={code} value={code}>{labels[code]}</option>)}
          </select>
          <select aria-label="Status kehadiran di venue" value={attendance} onChange={(e) => setAttendance(e.target.value)}>
            <option value="">Semua kehadiran di venue</option>
            {attendanceOptions.map((code) => <option key={code} value={code}>{labels[code]}</option>)}
          </select>
          {checkInDays.map((day) => <select key={day.date} aria-label={`Status ${day.label}`}
            value={checkInFilters[day.date] || ''} onChange={(e) => setCheckInFilters({ ...checkInFilters, [day.date]: e.target.value })}>
            <option value="">{day.label} · Semua status</option>
            {['sudah_absen', 'belum_absen'].map((code) => <option key={code} value={code}>{labels[code]}</option>)}
          </select>)}
        </>}
        {view === 'facilitators' && <select aria-label="Ambang tunggakan" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
          {[1, 2, 3, 7].map((day) => <option key={day} value={day}>Lewat {day} hari</option>)}
        </select>}
        {view === 'ranking' && movement && <input type="date" aria-label="Tanggal acuan pergerakan kiriman"
          value={baseline} onChange={(e) => setCustomBaseline(e.target.value)} />}
      </div>
      {view === 'ranking' && <p className="muted small">Capaian dihitung dari laporan yang sudah dikirim dibanding seluruh sekolah binaan. LO tanpa data monitoring belum masuk peringkat.</p>}
      {view === 'ranking' ? <ReportingRanking rows={ranking} movement={movement} movementLabel={movementLabel} own={own} />
        : <ReportingTable key={JSON.stringify([view, venue, lo, status, attendance, checkInFilters, term, threshold])}
          headers={headers} rows={rows} fullWidthColumn={current && view === 'schools' ? 'Kehadiran di venue' : undefined} />}
      {detail && <section className="card reporting-detail">
        <div className="page-head"><h3>Sekolah binaan {selectedFacilitator.name}</h3>
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
      <div className="reporting-datasets" role="group" aria-label="Kegiatan pelaporan">
        {Object.entries(datasetNames).map(([key, label]) => <button key={key} className={dataset === key ? 'on' : ''} aria-pressed={dataset === key}
          onClick={() => { if (key !== dataset) { setDataset(key); setData(null); setError(''); } }}>{label}</button>)}
      </div>
      {error && <p className="alert alert--err" role="alert">{error} <button className="btn btn--sm" onClick={refresh}>Coba lagi</button></p>}
      {!data && !error && <div className="kpis"><SkelCards n={3} h={76} /></div>}
      {data && <ReportingView key={`${dataset}:${lo ? 'lo' : 'admin'}`} data={data} dataset={dataset} refresh={refresh} account={lo ? user : null}
        canImport={dataset === 'current' && user?.role === 'admin' && !lo} />}
    </div>
  );
}
