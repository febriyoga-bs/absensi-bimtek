import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import jsQR from 'jsqr';
import { api } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { arrivalBadge, fmtDT, sessionTitle } from './shared.js';
import { SkelRows, Spinner } from '../../components/Skeleton.jsx';
import CameraCapture from '../../components/CameraCapture.jsx';
import WhatsAppLink from '../../components/WhatsAppLink.jsx';
import { formatRoom } from '../../lib/room.js';
import EditAttendanceNote from './EditAttendanceNote.jsx';
import { personName } from '../../lib/personName.js';

// Absenkan lewat scan QR dinonaktifkan sementara. Ubah ke true untuk memunculkan lagi tab "Scan QR"
// (server juga perlu QR_SCAN_ENABLED = true di server/src/routes/admin.js).
const QR_SCAN_ENABLED = false;

/** Bunyi singkat: nada tinggi = berhasil, nada rendah = gagal */
function beep(ok) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = ok ? 1150 : 300; o.type = ok ? 'sine' : 'square';
    g.gain.value = 0.12; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + (ok ? 0.15 : 0.35));
    o.onended = () => ctx.close();
  } catch { /* abaikan */ }
  navigator.vibrate?.(ok ? 80 : [60, 60, 60]);
}

const KIND = {
  ok: { cls: 'ok', icon: 'check', title: 'Absen tercatat' },
  unavailable: { cls: 'warn', icon: 'clock', title: 'Mundur/Berhalangan Hadir' },
  dup: { cls: 'warn', icon: 'clock', title: 'Status sudah tercatat' },
  err: { cls: 'err', icon: 'x', title: 'Gagal' },
};

const categories = {
  sekolah: { label: 'Sekolah', icon: 'school', placeholder: 'Cari nama, sekolah, NPSN, atau kode' },
  fasil: { label: 'Fasilitator', icon: 'users', placeholder: 'Cari nama, kode, atau PTN fasilitator' },
  dinas: { label: 'Dinas Pendidikan', icon: 'building', placeholder: 'Cari nama atau kode Dinas Pendidikan' },
  bpmp: { label: 'BB/BPMP', icon: 'building', placeholder: 'Cari nama atau kode BB/BPMP' },
};
const number = new Intl.NumberFormat('id-ID');
const directoryHeaders = ['Peserta', 'Sekolah / Instansi', 'Venue', 'LO bertugas', 'Fasilitator', 'Status Laporan 50%', 'Sesi', 'Kehadiran di venue', 'Status absensi'];
const sortKeys = ['name','institution','venue','lo','facilitator','report','session','arrival','attendance'];
const columnWidths = [240,260,190,180,220,240,190,160,160,220];
function savedDisplay() {
  try {
    const value = JSON.parse(localStorage.getItem('bimtek-scan-display') || '{}');
    return { showFilters: value.showFilters !== false, hiddenColumns: Array.isArray(value.hiddenColumns)
      ? value.hiddenColumns.filter((name) => directoryHeaders.includes(name) && name !== 'Peserta') : [] };
  } catch { return { showFilters: true, hiddenColumns: [] }; }
}
const reportLabels = { belum_kirim: 'Belum kirim', menunggu_reviu: 'Menunggu reviu', ditolak: 'Ditolak', diterima: 'Diterima', belum_ada_data: 'Belum ada data' };

function attendanceStatus(person) {
  if (person.unavailable) return ['Mundur/Berhalangan Hadir', 'tag--off'];
  if (person.attended?.status === 'ditolak') return ['Ditolak', 'tag--off'];
  if (person.attended?.status === 'review') return ['Perlu dicek', 'tag--venue'];
  if (person.attended) return ['Sudah absen', 'tag--open'];
  return [person.session ? 'Belum absen' : 'Belum ada sesi', 'tag--off'];
}

export default function Scan() {
  const { lo, user } = useOutletContext();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const busyRef = useRef(false);
  const recentRef = useRef(new Map()); // isi QR → waktu terakhir dipindai (hindari dobel)
  const [camErr, setCamErr] = useState(null);
  const [running, setRunning] = useState(true);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [manual, setManual] = useState('');
  const [tab, setTab] = useState(QR_SCAN_ENABLED && lo ? 'qr' : 'sekolah');
  const [search, setSearch] = useState('');
  const [filterVenue, setFilterVenue] = useState('');
  const [filterArrival, setFilterArrival] = useState('');
  const [filterLo, setFilterLo] = useState('');
  const [showFilters, setShowFilters] = useState(() => savedDisplay().showFilters);
  const [hiddenColumns, setHiddenColumns] = useState(() => savedDisplay().hiddenColumns);
  useEffect(() => {
    try { localStorage.setItem('bimtek-scan-display', JSON.stringify({ showFilters, hiddenColumns })); } catch { /* storage unavailable */ }
  }, [showFilters, hiddenColumns]);
  const columnHidden = (name) => hiddenColumns.includes(name);
  const [filterFacilitator, setFilterFacilitator] = useState('');
  const [filterAttendance, setFilterAttendance] = useState('');
  const [sort, setSort] = useState('name');
  const [direction, setDirection] = useState('asc');
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(1);
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(null);
  const [shot, setShot] = useState(null);
  const [noteTarget, setNoteTarget] = useState(null);
  const [noteNotice, setNoteNotice] = useState('');
  const [testSessionId, setTestSessionId] = useState('');
  const [testSessions, setTestSessions] = useState([]);
  const [sessionError, setSessionError] = useState('');
  const [unavailableTarget, setUnavailableTarget] = useState(null);
  const [unavailableError, setUnavailableError] = useState('');
  const unavailableDialog = useRef(null);

  useEffect(() => {
    let current = true;
    api('/admin/sessions', { admin: true }).then((sessions) => {
      if (current) {
        setTestSessions(sessions.filter((session) => session.is_test && session.is_open &&
          ['peserta', 'semua'].includes(session.role)));
        setSessionError('');
      }
    }).catch((error) => { if (current) setSessionError(error.message); });
    return () => { current = false; };
  }, [revision]);

  useEffect(() => {
    if (unavailableTarget && !unavailableDialog.current.open) unavailableDialog.current.showModal();
  }, [unavailableTarget]);

  async function submit(body) {
    busyRef.current = true;
    let r;
    try {
      const d = await api('/admin/scan', { method: 'POST', admin: true, body });
      r = { kind: d.status === 'berhalangan' ? 'unavailable' : 'ok', person: d.person, session: d.session, at: d.at };
    } catch (e) {
      const d = e.data || {};
      r = { kind: e.status === 409 ? 'dup' : 'err', msg: e.message, person: d.person, session: d.session, at: d.at };
    }
    r.id = Date.now();
    beep(r.kind === 'ok' || r.kind === 'unavailable');
    setResult(r);
    setHistory((h) => [r, ...h].slice(0, 30));
    if (body.qr) setTimeout(() => { busyRef.current = false; }, 1200);
    else busyRef.current = false;
    return r;
  }

  useEffect(() => {
    if (tab === 'qr') return;
    let current = true;
    setLoading(true);
    setListError('');
    const params = new URLSearchParams({ category: tab, q: search.trim(), page, venue_id: filterVenue, arrival: filterArrival,
      lo_id: filterLo, attendance: filterAttendance, facilitator: tab === 'sekolah' ? filterFacilitator : '', sort, direction });
    if (testSessionId) params.set('session_id', testSessionId);
    if (lo && showAll) params.set('scope', 'all');
    const timer = setTimeout(() => {
      api(`/admin/scan/participants?${params}`, { admin: true })
        .then((response) => { if (current) setList(response); })
        .catch((error) => { if (current) setListError(error.message); })
        .finally(() => { if (current) setLoading(false); });
    }, search.trim() ? 220 : 0);
    return () => { current = false; clearTimeout(timer); };
  }, [tab, search, page, filterVenue, filterArrival, filterLo, filterFacilitator, filterAttendance, sort, direction, lo, showAll, revision, testSessionId]);

  function changeTab(next) {
    if (tab === next) return;
    setTab(next);
    setSearch('');
    setPage(1);
    setLoading(true);
  }

  function absenkan(p) {
    setShot({ code: p.code, name: p.representative ? personName(p.representative.name) : p.name,
      originalName: p.representative ? p.name : null, position: p.position, school: p.institution?.split('; ')[0],
      sessionId: p.session?.id, sessionName: sessionTitle(p.session), isTest: p.session?.is_test });
  }

  async function sendShot(photo, note) {
    const target = shot;
    setPending(target.code);
    const r = await submit({ code: target.code, session_id: target.sessionId, photo, note });
    setPending(null);
    if (r.kind !== 'err') {
      setShot(null);
      setRevision((value) => value + 1);
    }
    return r;
  }

  async function markUnavailable(event) {
    event.preventDefault();
    if (!unavailableTarget || busyRef.current) return;
    const p = unavailableTarget;
    setUnavailableError('');
    setPending(p.code);
    const r = await submit({ code: p.code, session_id: p.session.id, unavailable: true });
    setPending(null);
    if (r.kind === 'err') setUnavailableError(r.msg);
    else {
      unavailableDialog.current.close();
      setRevision((value) => value + 1);
    }
  }

  // Kamera pemindai hanya aktif pada tab QR.
  useEffect(() => {
    if (!running || tab !== 'qr') return undefined;
    let stream; let timer; let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
        });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setCamErr(null);
        const tick = () => {
          if (stopped) return;
          if (!busyRef.current && v.readyState >= 2 && v.videoWidth) {
            const scale = Math.min(1, 640 / v.videoWidth);
            const w = Math.round(v.videoWidth * scale); const h = Math.round(v.videoHeight * scale);
            const c = canvasRef.current; c.width = w; c.height = h;
            const g = c.getContext('2d', { willReadFrequently: true });
            g.drawImage(v, 0, 0, w, h);
            const code = jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
            if (code?.data) {
              const now = Date.now();
              const last = recentRef.current.get(code.data) || 0;
              if (now - last > 6000) { recentRef.current.set(code.data, now); submit({ qr: code.data }); }
            }
          }
          timer = setTimeout(tick, 160);
        };
        tick();
      } catch (e) {
        setCamErr(e.name === 'NotAllowedError'
          ? 'Izin kamera ditolak. Izinkan kamera di pengaturan browser lalu muat ulang halaman.'
          : 'Kamera tidak bisa dibuka. Gunakan Chrome/Safari terbaru lewat HTTPS, atau ketik kode secara manual.');
      }
    })();
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [running, tab]);

  const K = result && KIND[result.kind];
  const pages = list ? Math.ceil(list.total / list.limit) : 0;
  const organizationTab = tab === 'dinas' || tab === 'bpmp';
  const headers = lo ? [...directoryHeaders, 'Tindakan'] : directoryHeaders;
  const visibleCount = headers.filter((name) => !columnHidden(name)).length;
  const tableWidth = headers.reduce((width, name, index) => width + (columnHidden(name) ? 0 : columnWidths[index]), 0);
  const activeFilterCount = [search.trim(), filterVenue, filterArrival, filterLo, filterAttendance,
    tab === 'sekolah' && filterFacilitator, testSessionId, lo && showAll].filter(Boolean).length;

  return (
    <>
      <div className="page-head">
        <div><h2>{lo ? 'Absenkan Peserta' : 'Daftar Peserta'}</h2>
          <p className="muted">
            {lo ? <>Catat absensi binaan serta peserta Dinas Pendidikan dan BB/BPMP di venue penugasan. Pilih sesi resmi atau sesi uji coba yang sedang dibuka{user?.venue && <> di <b>{user.venue.name}</b></>}.</>
              : 'Lihat daftar peserta, status kedatangan, dan absensi per venue. Pencatatan dilakukan oleh LO.'}
          </p></div>
        {tab === 'qr' && (
          <button className="btn" onClick={() => setRunning((x) => !x)}>
            <Icon name={running ? 'x' : 'camera'} size={18} />{running ? 'Matikan kamera' : 'Nyalakan kamera'}
          </button>
        )}
      </div>
      <div className="tabs" role="group" aria-label="Jenis peserta">
        {QR_SCAN_ENABLED && lo && <button className={tab === 'qr' ? 'on' : ''} onClick={() => changeTab('qr')} disabled={!!pending}><Icon name="qr" size={16} /> Scan QR</button>}
        {Object.entries(categories).map(([key, category]) => (
          <button key={key} className={tab === key ? 'on' : ''} aria-pressed={tab === key} onClick={() => changeTab(key)} disabled={!!pending}>
            <Icon name={category.icon} size={16} /> {category.label}
          </button>
        ))}
      </div>

      <div className={tab === 'qr' ? 'scan' : 'scan scan--table'}>
        {tab !== 'qr' && (
          <section className="scan__directory">
            <div className="scan-display-controls">
              <button type="button" className="btn btn--sm" aria-expanded={showFilters} aria-controls="scan-filters" onClick={() => setShowFilters((value) => !value)}>
                {showFilters ? 'Sembunyikan filter' : 'Tampilkan filter'}{activeFilterCount > 0 ? ` (${activeFilterCount} aktif)` : ''}
              </button>
              <details className="scan-column-picker">
                <summary className="btn btn--sm">Atur kolom ({visibleCount}/{headers.length})</summary>
                <div className="scan-column-options">
                  {headers.map((name) => <label className="check" key={name}>
                    <input type="checkbox" checked={!columnHidden(name)} disabled={name === 'Peserta' || name === 'Tindakan'}
                      onChange={(event) => setHiddenColumns((current) => event.target.checked ? current.filter((item) => item !== name) : [...current, name])} />
                    <span>{name}{name === 'Peserta' || name === 'Tindakan' ? ' (tetap)' : ''}</span>
                  </label>)}
                </div>
              </details>
              <button type="button" className="btn btn--sm" onClick={() => { setHiddenColumns([]); setShowFilters(true); }}>Reset tampilan</button>
              <button type="button" className="btn btn--sm" disabled={loading || !!pending} onClick={() => setRevision((value) => value + 1)}>
                <Icon name="refresh" size={15} />Muat ulang
              </button>
            </div>
            <div id="scan-filters" className="toolbar filters" hidden={!showFilters}>
              <label><span>Sesi absensi</span><select aria-label="Sesi absensi" value={testSessionId} disabled={!!pending || !!shot} onChange={(event) => {
                setTestSessionId(event.target.value); setLoading(true); setPage(1); setResult(null);
              }}>
                <option value="">Sesi resmi yang sedang dibuka</option>
                {testSessions.map((session) => <option key={session.id} value={session.id}>Uji coba · {sessionTitle(session)}</option>)}
                {!testSessions.length && <option disabled>Belum ada sesi uji coba yang dibuka</option>}
                {testSessionId && !testSessions.some((session) => String(session.id) === testSessionId) &&
                  <option value={testSessionId}>Sesi uji coba dipilih · tidak tersedia</option>}
              </select></label>
              {lo && <label><span>Cakupan peserta</span><select aria-label="Cakupan peserta" value={showAll ? 'all' : 'assigned'} onChange={(e) => {
                setLoading(true); setShowAll(e.target.value === 'all'); setFilterVenue(''); setPage(1);
              }}>
                <option value="assigned">{organizationTab ? 'Venue saya' : 'Binaan saya'}</option>
                <option value="all">Semua peserta</option>
              </select></label>}
              <label><span>Pencarian peserta</span><input type="search" aria-label="Cari peserta" placeholder={categories[tab].placeholder} value={search} maxLength={150}
                onChange={(e) => { setLoading(true); setSearch(e.target.value); setPage(1); }} /></label>
              {(!lo || showAll) && <label><span>Venue</span><select aria-label="Filter venue" value={filterVenue}
                onChange={(e) => { setLoading(true); setFilterVenue(e.target.value); setPage(1); }}>
                <option value="">Semua venue</option>
                {list?.venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
              </select></label>}
              <label><span>LO bertugas</span><select aria-label="Filter LO bertugas" value={filterLo} onChange={(e) => {
                setLoading(true); setFilterLo(e.target.value); setPage(1);
              }}>
                <option value="">Semua LO bertugas</option>
                {filterLo && !list?.owners?.some((owner) => String(owner.id) === filterLo) &&
                  <option value={filterLo}>LO dipilih (di luar venue)</option>}
                {list?.owners?.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
              </select></label>
              {tab === 'sekolah' && <label><span>Fasilitator</span><select aria-label="Filter fasilitator" value={filterFacilitator} onChange={(e) => {
                setLoading(true); setFilterFacilitator(e.target.value); setPage(1);
              }}>
                <option value="">Semua fasilitator</option>
                {filterFacilitator && !list?.facilitators?.includes(filterFacilitator) && <option value={filterFacilitator}>{filterFacilitator} (di luar filter saat ini)</option>}
                {list?.facilitators?.map((name) => <option key={name} value={name}>{name}</option>)}
              </select></label>}
              <label><span>Status absensi</span><select aria-label="Filter status absensi" value={filterAttendance} onChange={(e) => {
                setLoading(true); setFilterAttendance(e.target.value); setPage(1);
              }}>
                <option value="">Semua status absensi</option>
                <option value="checked_in">Sudah absen</option>
                <option value="not_checked_in">Belum absen</option>
                <option value="review">Perlu dicek</option>
                <option value="ditolak">Ditolak</option>
                <option value="berhalangan">Mundur/Berhalangan Hadir</option>
                <option value="no_session">Belum ada sesi</option>
              </select></label>
              <label><span>Status kedatangan</span><select aria-label="Filter kehadiran dari rekap" value={filterArrival} onChange={(e) => {
                setLoading(true); setFilterArrival(e.target.value); setPage(1);
              }}>
                <option value="">SEMUA STATUS KEDATANGAN</option>
                <option value="arrived">SUDAH TIBA</option>
                <option value="queued">SEDANG ANTRE</option>
                <option value="unrecorded">BELUM TERDATA</option>
              </select></label>
            </div>
            {sessionError && <p className="alert alert--warn" role="status">Daftar sesi uji coba gagal dimuat. {sessionError}</p>}
            {testSessionId && <p className="alert alert--warn" role="status">Mode uji coba aktif. Pencatatan masuk ke sesi uji coba yang dipilih.</p>}
            {listError && <div className="alert alert--err" role="alert">{listError}</div>}
            {!loading && !listError && list?.arrival_summary && (
              <div className="scan__arrival-recap">
                <b>Rekap Kehadiran</b>
                <span className="tag tag--arrival">{number.format(list.arrival_summary.arrived)} SUDAH TIBA</span>
                <span className="tag tag--venue">{number.format(list.arrival_summary.queued)} SEDANG ANTRE</span>
                <span className="tag tag--off">{number.format(list.arrival_summary.unrecorded)} BELUM TERDATA</span>
                <Link className="btn btn--sm" to="/admin/kehadiran">Buka rekap</Link>
                {list.arrival_summary.unrecorded > 0 && !list.arrival_summary.arrived && !list.arrival_summary.queued &&
                  <span className="scan__arrival-note muted small">Belum ada data kedatangan dari rekap Excel yang cocok dengan daftar ini.</span>}
              </div>
            )}
            <p className="muted small" aria-live="polite">
              {loading ? 'Memuat daftar peserta…' : `${number.format(list?.total || 0)} peserta`}
            </p>
            <div className="assignment-table">
              <table className="table stack-table scan-table" style={{ '--scan-table-width': `${tableWidth}px` }} role="table" aria-label={`Daftar ${categories[tab].label}`} aria-busy={loading}>
                <thead role="rowgroup"><tr role="row">
                  {headers.map((name, index) => (
                    <th key={name} scope="col" role="columnheader" hidden={columnHidden(name)}
                      aria-sort={sortKeys[index] ? sort === sortKeys[index] ? direction === 'asc' ? 'ascending' : 'descending' : 'none' : undefined}>
                      {sortKeys[index] ? <button type="button" className="scan-sort" onClick={() => {
                        setLoading(true); setPage(1);
                        setDirection(sort === sortKeys[index] && direction === 'asc' ? 'desc' : 'asc'); setSort(sortKeys[index]);
                      }}>{name} <span aria-hidden="true">{sort === sortKeys[index] ? direction === 'asc' ? '↑' : '↓' : '↕'}</span></button> : name}
                    </th>
                  ))}
                </tr></thead>
                <tbody role="rowgroup">
                  {loading && <SkelRows rows={4} cols={visibleCount} />}
                  {!loading && !listError && !list?.rows.length && <tr role="row"><td role="cell" colSpan={visibleCount}>
                    {lo && !showAll && !search.trim() && !filterArrival
                      ? `Tidak ada ${organizationTab ? 'peserta kategori ini di venue Anda' : 'binaan di kategori ini'}. Pilih Semua peserta untuk melihat daftar lengkap.`
                      : 'Tidak ada peserta yang cocok.'}
                  </td></tr>}
                  {!loading && !listError && list?.rows.map((p) => {
                    const [status, style] = attendanceStatus(p);
                    const [arrival, arrivalStyle] = arrivalBadge(p.arrival_status);
                    return (
                      <tr key={p.id} role="row">
                        <td role="cell"><b>{p.representative ? personName(p.representative.name) : p.name}</b>
                          {p.representative && <><span className="tag tag--venue">Mewakili</span>
                            <div className="muted small">Mewakili {personName(p.name)}</div></>}
                          {!p.representative && <WhatsAppLink name={p.name} phone={p.phone} />}
                          <div className="muted small">{[p.position, p.code].filter(Boolean).join(' · ')}</div></td>
                        <td role="cell" data-label="Sekolah / Instansi" hidden={columnHidden('Sekolah / Instansi')} className="cell-clamp">{p.institution || '—'}
                          {p.npsn && <div className="muted small">NPSN {p.npsn}</div>}
                        </td>
                        <td role="cell" data-label="Venue" hidden={columnHidden('Venue')}>
                          {p.venue_name ? <span className="tag tag--venue">{p.venue_name}</span> : '—'}
                          {p.ruangan && <div className="muted small">{formatRoom(p.ruangan)}</div>}
                        </td>
                        <td role="cell" data-label="LO bertugas" hidden={columnHidden('LO bertugas')} className="small">
                          {p.assigned_los?.length ? <>
                            {organizationTab && <div className="muted small">LO venue</div>}
                            {p.assigned_los.map((name) => <div key={name}>{name}</div>)}
                          </> : <span className="muted">Belum terpetakan</span>}
                        </td>
                        <td role="cell" data-label="Fasilitator" hidden={columnHidden('Fasilitator')} className="small">
                          {p.assigned_facilitators?.length
                            ? p.assigned_facilitators.map((name) => <div key={name}>{name}</div>)
                            : <span className="muted">{tab === 'sekolah' ? 'Belum terpetakan' : '—'}</span>}
                        </td>
                        <td role="cell" data-label="Status Laporan 50%" hidden={columnHidden('Status Laporan 50%')} className="small">
                          {p.school_reports?.length ? p.school_reports.map((report) => <div key={report.npsn}>
                            {p.school_reports.length > 1 && <div className="muted small">{report.name} · {report.npsn}</div>}
                            <span className={`tag ${report.status === 'diterima' ? 'tag--open' : report.status === 'menunggu_reviu' ? 'tag--venue' : 'tag--off'}`}>
                              {report.status === 'belum_kirim' && report.progress != null && Number(report.progress) >= 50
                                ? 'Siap kirim, belum diajukan' : reportLabels[report.status] || 'Belum ada data'}
                            </span>
                          </div>) : <span className="muted">{tab === 'sekolah' ? 'Belum ada data' : '—'}</span>}
                        </td>
                        <td role="cell" data-label="Sesi" hidden={columnHidden('Sesi')} className="small">{sessionTitle(p.session)}
                          {p.session?.is_test && <div><span className="tag tag--venue">Uji coba</span></div>}
                        </td>
                        <td role="cell" data-label="Kehadiran di venue" hidden={columnHidden('Kehadiran di venue')}>
                          <span className={`tag ${arrivalStyle}`}>
                            {arrival.toUpperCase()}
                          </span>
                        </td>
                        <td role="cell" data-label="Status absensi" hidden={columnHidden('Status absensi')}><span className={`tag ${style}`}>{status}</span></td>
                        {lo && <td role="cell" className="stack-full">
                          {p.attended?.can_edit_note && <button type="button" className="btn btn--sm"
                            onClick={() => { setNoteNotice(''); setNoteTarget({ ...p.attended, name: p.name }); }}>Ubah catatan</button>}
                          {p.can_check_in && !p.attended ? (
                            <div className="row scan__row-actions">
                              <button className="btn btn--sm btn--primary" disabled={!p.session || !!pending}
                                onClick={() => absenkan(p)}>{pending === p.code ? <Spinner size={13} /> : 'Absenkan'}</button>
                              {!p.unavailable && <button className="btn btn--sm btn--danger scan__unavailable" disabled={!p.session || !!pending}
                                onClick={() => { setUnavailableError(''); setUnavailableTarget(p); }}>Mundur/Berhalangan Hadir</button>}
                            </div>
                          ) : <span className="muted small">{p.can_check_in ? '—' : organizationTab ? 'Di luar venue' : 'Di luar binaan'}</span>}
                        </td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!listError && pages > 1 && <div className="pager">
              <button className="btn btn--sm" disabled={page <= 1 || loading || !!pending} onClick={() => { setLoading(true); setPage(page - 1); }}>Sebelumnya</button>
              <span className="muted small">Halaman {page} dari {pages}</span>
              <button className="btn btn--sm" disabled={page >= pages || loading || !!pending} onClick={() => { setLoading(true); setPage(page + 1); }}>Berikutnya</button>
            </div>}
          </section>
        )}

        {QR_SCAN_ENABLED && tab === 'qr' && (
        <div className="scan__cam card">
          <div className="scan__view">
            {running && !camErr && <video ref={videoRef} playsInline muted />}
            {running && !camErr && <span className="scan__frame" aria-hidden="true" />}
            {(!running || camErr) && (
              <div className="scan__off"><Icon name="camera" size={34} /><span>{camErr || 'Kamera dimatikan'}</span></div>
            )}
          </div>
          <canvas ref={canvasRef} hidden />
          <form className="row scan__manual" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { setShot({ code: manual.trim(), name: manual.trim() }); setManual(''); } }}>
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Ketik kode manual (mis. B-20100001)" />
            <button className="btn btn--primary" disabled={!manual.trim()}>Catat</button>
          </form>
        </div>
        )}

        {lo && <div className="scan__side">
          {result ? (
            <div key={result.id} className={`card scan__result scan__result--${K.cls}`} role="status">
              <span className="scan__badge"><Icon name={K.icon} size={26} /></span>
              <div>
                <b className="scan__title">{K.title}</b>
                {result.person && (
                  <>
                    <div className="scan__name">{result.person.name}</div>
                    <div className="muted small">{[result.person.position, result.person.code].filter(Boolean).join(' · ')}</div>
                    {result.person.institution && <div className="muted small">{result.person.institution}</div>}
                    {result.person.ruangan && <div className="small">Ruangan: <b>{formatRoom(result.person.ruangan)}</b></div>}
                  </>
                )}
                {result.session && <div className="small">{sessionTitle(result.session)}</div>}
                {result.at && <div className="small">{result.kind === 'dup' ? 'Tercatat sebelumnya: ' : ''}{fmtDT(result.at)} WIB</div>}
                {result.msg && <div className="small scan__msg">{result.msg}</div>}
              </div>
            </div>
          ) : tab === 'qr' && (
            <div className="card scan__result"><span className="muted">Belum ada peserta yang diabsenkan.</span></div>
          )}

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Riwayat absen dari perangkat ini</h3>
            {!history.length && <p className="muted small">Kosong.</p>}
            <ul className="scan__hist">
              {history.map((h) => (
                <li key={h.id} className={`scan__hist--${KIND[h.kind].cls}`}>
                  <Icon name={KIND[h.kind].icon} size={15} />
                  <span><b>{h.person?.name || h.msg}</b>{h.person && h.kind !== 'ok' && <small> — {h.msg || KIND[h.kind].title}</small>}
                    {h.session && <small className="muted"> · {sessionTitle(h.session)}</small>}
                  </span>
                  <small className="muted">{new Date(h.id).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</small>
                </li>
              ))}
            </ul>
          </div>
        </div>}
      </div>
      <dialog ref={unavailableDialog} className="assignment-dialog" aria-labelledby="unavailable-title"
        onClose={() => setUnavailableTarget(null)} onCancel={(event) => { if (pending) event.preventDefault(); }}>
        {unavailableTarget && <>
          <header><h3 id="unavailable-title">Mundur/Berhalangan Hadir</h3></header>
          <p>Tandai <strong>{unavailableTarget.name}</strong> sebagai mundur atau berhalangan hadir?</p>
          <p className="muted small">{unavailableTarget.institution}</p>
          <p><b>{sessionTitle(unavailableTarget.session)}</b>
            {unavailableTarget.session.is_test && <span className="tag tag--venue">Uji coba</span>}
          </p>
          {unavailableError && <p className="alert alert--err" role="alert">{unavailableError}</p>}
          <form onSubmit={markUnavailable} className="row">
            <button type="button" className="btn" autoFocus disabled={!!pending} onClick={() => unavailableDialog.current.close()}>Batal</button>
            <button type="submit" className="btn btn--danger scan__unavailable" disabled={!!pending}>
              {pending ? 'Menyimpan…' : 'Tandai berhalangan'}
            </button>
          </form>
        </>}
      </dialog>
      {noteNotice && <p className="alert alert--ok" role="status">{noteNotice}</p>}
      {noteTarget && <EditAttendanceNote key={noteTarget.id} target={noteTarget} onClose={() => setNoteTarget(null)}
        onSaved={() => { setNoteNotice('Catatan berhasil diperbarui.'); setRevision((value) => value + 1); }} />}
      {shot && <LoShot target={shot} user={user} busy={pending === shot.code} onSend={sendShot} onClose={() => setShot(null)} />}
    </>
  );
}

/** Kamera untuk memotret peserta yang diabsenkan LO (default kamera belakang, bisa dibalik). */
function LoShot({ target, user, busy, onSend, onClose }) {
  const camRef = useRef(null);
  const [facing, setFacing] = useState('environment');
  const [photo, setPhoto] = useState(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState(null);

  function capture() {
    const lines = [
      target.sessionName ? `${target.isTest ? 'Uji coba · ' : ''}${target.sessionName}` : '',
      `${target.name}${target.position ? ` (${target.position})` : ''}`,
      target.originalName ? `Mewakili ${personName(target.originalName)}` : '',
      target.school || target.code,
      `${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB${user?.venue ? ' • ' + user.venue.name : ''}`,
      `Diabsenkan oleh ${user?.name || 'LO'}`,
    ];
    const img = camRef.current?.capture(lines);
    if (!img) return setErr('Kamera belum siap.');
    setErr(null); setPhoto(img);
  }

  async function send(e) {
    e.preventDefault();
    if (!photo || !note.trim() || busy) return;
    setErr(null);
    const r = await onSend(photo, note.trim());
    if (r?.kind === 'err') {
      setErr(r.msg);
      if (r.msg.startsWith('Foto peserta wajib')) setPhoto(null);
    }
  }

  return (
    <div className="lo-shot" role="dialog" aria-modal="true" aria-label="Foto peserta">
      <div className="lo-shot__card">
        <div className="lo-shot__head">
          <Icon name="camera" size={22} />
          <span><b>Foto {target.name}</b>{target.originalName && <small>Mewakili {personName(target.originalName)}</small>}
            <small>{[target.position, target.school].filter(Boolean).join(' · ') || 'Arahkan kamera ke wajah peserta'}</small></span>
          <button type="button" className="btn btn--sm" onClick={onClose} disabled={busy} aria-label="Tutup"><Icon name="x" size={16} /></button>
        </div>
        <div className="viewfinder">
          {photo ? <img src={photo} alt="Foto peserta" className="preview lo-shot__preview" /> : <CameraCapture key={facing} ref={camRef} facing={facing} />}
          {!photo && (
            <button type="button" className="lo-shot__flip" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>
              <Icon name="refresh" size={14} /> {facing === 'user' ? 'Kamera belakang' : 'Kamera depan'}
            </button>
          )}
          {!photo && <div className="viewfinder__actions">
            <span className="vf-note">Pastikan wajah peserta terlihat jelas</span>
            <button type="button" className="shutter" onClick={capture} aria-label="Ambil foto"><Icon name="camera" size={30} /></button>
          </div>}
        </div>
        {err && <div className="alert alert--err" role="alert"><Icon name="alert" size={18} /><span>{err}</span></div>}
        {photo && <form className="form lo-shot__form" onSubmit={send}>
          <label>Catatan
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kendala yang dihadapi peserta"
              rows={3} maxLength={1000} required disabled={busy} />
          </label>
          <div className="vf-buttons">
            <button type="button" className="btn" onClick={() => setPhoto(null)} disabled={busy}><Icon name="refresh" size={18} /> Ulangi</button>
            <button type="submit" className="btn btn--primary" disabled={busy || !note.trim()}>
              {busy ? <><Spinner /> Menyimpan…</> : <><Icon name="check" size={18} /> Absenkan</>}
            </button>
          </div>
        </form>}
      </div>
    </div>
  );
}
