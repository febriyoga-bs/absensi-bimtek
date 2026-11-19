import { personName } from '../../lib/personName.js';
import FilterField from '../../components/FilterField.jsx';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { api, adminUrl } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { MapModal } from '../../components/MapEmbed.jsx';
import { fmtDT, FLAG_LABEL, sessionTitle } from './shared.js';
import { SkelCards } from '../../components/Skeleton.jsx';
import EditAttendanceNote from './EditAttendanceNote.jsx';
import AttendanceDownloadDialog from './AttendanceDownloadDialog.jsx';

const ST_LABEL = { valid: 'Valid', review: 'Perlu dicek', ditolak: 'Ditolak', berhalangan: 'Mundur/Berhalangan Hadir' };
const PAGE = 48;
const RetryPhoto = lazy(() => import('./Scan.jsx').then((module) => ({ default: module.LoShot })));
const DELETE_CONFIRMATION = 'saya ingin menghapus absen ini';
const dist = (m) => (m == null ? '-' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

export default function Records() {
  const [params, setParams] = useSearchParams();
  const [sessions, setSessions] = useState([]);
  const [venues, setVenues] = useState([]);
  const [recorders, setRecorders] = useState([]);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const { lo, user } = useOutletContext() || {};
  const [retryTarget, setRetryTarget] = useState(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const loadRevision = useRef(0);
  const [attempts, setAttempts] = useState([]);
  const [tab, setTab] = useState('absen');
  const [zoom, setZoom] = useState(null);
  const [mapPoint, setMapPoint] = useState(null);
  const deleteDialog = useRef(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteNotice, setDeleteNotice] = useState('');
  const [noteTarget, setNoteTarget] = useState(null);
  const [noteNotice, setNoteNotice] = useState('');
  const requestedSid = params.get('sesi') || '';
  const selectedSession = sessions.find((session) => String(session.id) === requestedSid)
    || sessions.find((session) => session.is_open) || sessions[sessions.length - 1];
  const sid = selectedSession ? String(selectedSession.id) : '';
  const recordedBy = lo ? '' : params.get('recorded_by') || '';
  const search = params.get('q') || '';
  const [searchInput, setSearchInput] = useState(search);
  const status = lo ? '' : params.get('status') || '';
  const sort = lo ? 'risk' : params.get('sort') || 'risk';
  const position = params.get('position') || '';
  const venue = lo ? '' : params.get('venue') || '';
  const page = Math.max(Number(params.get('hal')) || 1, 1);
  // ganti filter → kembali ke halaman 1
  const setParam = (k, v) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set('sesi', sid); next.set('hal', '1'); next.set(k, v);
    return next;
  });
  const pages = Math.max(Math.ceil(total / PAGE), 1);
  useEffect(() => { setSearchInput(search); }, [search]);
  useEffect(() => {
    if (!sid || searchInput.trim() === search) return;
    const timer = setTimeout(() => setParam('q', searchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchInput, search, sid]);

  useEffect(() => {
    api('/admin/venues', { admin: true }).then(setVenues).catch((error) => setLoadError(error.message));
    api('/admin/sessions', { admin: true }).then((s) => {
      setSessions(s);
      if (!s.length) setLoading(false);
    }).catch((error) => { setLoadError(error.message); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!sid || requestedSid === sid) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('sesi', sid); next.delete('hal');
      if (requestedSid) { next.delete('venue'); next.delete('recorded_by'); }
      return next;
    }, { replace: true });
  }, [sid, requestedSid]);

  const load = () => {
    if (!sid || !sessions.some((session) => String(session.id) === sid)) return;
    // Wait for URL normalization before using activity-specific filters.
    if (requestedSid && requestedSid !== sid) return;
    const revision = ++loadRevision.current;
    const qs = new URLSearchParams({
      session_id: sid, limit: PAGE, offset: (page - 1) * PAGE, sort,
      ...(recordedBy && { recorded_by: recordedBy }),
      ...(search && { q: search }),
      ...(position && { position }),
      ...(status && { status }), ...(venue && { venue_id: venue }),
    });
    setLoading(true); setLoadError('');
    api(`/admin/attendance?${qs}`, { admin: true })
      .then((d) => { if (loadRevision.current !== revision) return; setRows(d.rows); setRecorders(d.recorders || []); setTotal(d.total); setCounts(d.counts); window.scrollTo({ top: 0 }); })
      .catch((error) => { if (loadRevision.current === revision) setLoadError(error.message); })
      .finally(() => { if (loadRevision.current === revision) setLoading(false); });
    if (!lo) api(`/admin/attempts?session_id=${sid}${venue ? `&venue_id=${venue}` : ''}${position ? `&position=${encodeURIComponent(position)}` : ''}`, { admin: true })
      .then((data) => { if (loadRevision.current === revision) setAttempts(data); }).catch(() => {});
  };
  useEffect(() => { load(); return () => { loadRevision.current++; }; }, [sid, requestedSid, status, venue, position, recordedBy, search, sort, page, sessions]);

  async function setStatus(id, st) {
    await api(`/admin/attendance/${id}`, { method: 'PATCH', admin: true, body: { status: st } });
    setRows((r) => r.map((x) => (x.id === id ? { ...x, status: st } : x)));
    // perbarui hitungan per status tanpa memuat ulang halaman
    setCounts((c) => {
      if (!c) return c;
      const old = rows.find((x) => x.id === id)?.status;
      return old && old !== st ? { ...c, [old]: c[old] - 1, [st]: c[st] + 1 } : c;
    });
  }

  async function retryAttendance(photo, note) {
    if (retryBusy || !retryTarget) return;
    setRetryBusy(true);
    try {
      await api('/admin/scan', { method: 'POST', admin: true,
        body: { code: retryTarget.code, session_id: retryTarget.sessionId, photo, note } });
      setRetryTarget(null); setNoteNotice('Absen ulang berhasil disimpan.'); load();
      return { kind: 'ok' };
    } catch (error) { return { kind: 'err', msg: error.message }; }
    finally { setRetryBusy(false); }
  }

  function openDeleteDialog(record) {
    setDeleteTarget(record);
    setConfirmation('');
    setDeleteError('');
    setDeleteNotice('');
    deleteDialog.current.showModal();
  }

  async function deleteAttendance(event) {
    event.preventDefault();
    if (!deleteTarget || deleting || confirmation !== DELETE_CONFIRMATION) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api(`/admin/attendance/${deleteTarget.id}`, { method: 'DELETE', admin: true, body: { confirmation } });
    } catch (error) {
      setDeleteError(error.message);
      return;
    } finally {
      setDeleting(false);
    }
    deleteDialog.current.close();
    setDeleteNotice(`Absensi ${deleteTarget.name} berhasil dihapus.`);
    setRows((current) => current.filter((record) => record.id !== deleteTarget.id));
    if (rows.length === 1 && page > 1) setParam('hal', String(page - 1));
    else load();
  }

  return (
    <>
      <div className="page-head"><div><h2>Verifikasi Absensi</h2>
        <p className="muted">{lo ? 'Kelola catatan, tolak, atau hapus absensi peserta yang Anda catat sendiri.' : 'Absen bertanda kuning terdeteksi mencurigakan. Periksa fotonya, lalu sahkan atau tolak.'}</p></div></div>
      <div className="toolbar">
        <FilterField label="Cari nama / NPSN"><input type="search" aria-label="Cari nama atau NPSN" placeholder="Nama peserta atau NPSN" maxLength={150}
          value={searchInput} onChange={(e) => setSearchInput(e.target.value)} /></FilterField>
        <FilterField label="Sesi absensi"><select value={sid} onChange={(e) => setParam('sesi', e.target.value)}>
          {sessions.map((s) => <option key={s.id} value={s.id}>{sessionTitle(s)} ({s.is_test ? 'Uji coba · ' : ''}{s.role})</option>)}
        </select></FilterField>
        {!lo && venues.length > 1 && (
          <FilterField label="Venue"><select value={venue} onChange={(e) => setParam('venue', e.target.value)}>
            <option value="">Semua venue</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></FilterField>
        )}
        {!lo && <FilterField label="Diabsenkan oleh LO"><select aria-label="Diabsenkan oleh LO" value={recordedBy} onChange={(e) => setParam('recorded_by', e.target.value)}>
          <option value="">Semua LO pencatat</option>
          {recordedBy && !recorders.includes(recordedBy) && <option value={recordedBy}>{personName(recordedBy)} (tidak ada di sesi/venue ini)</option>}
          {recorders.map((name) => <option key={name} value={name}>{personName(name)}</option>)}
        </select></FilterField>}
        <FilterField label="Filter jabatan"><select aria-label="Filter jabatan" value={position} onChange={(e) => setParam('position', e.target.value)}>
          <option value="">Semua jabatan</option>
          <option value="lo">LO</option>
          <option value="bendahara">Bendahara</option>
          <option value="pengawas">Pengawas</option>
          <option value="fasil">Fasilitator</option>
        </select></FilterField>
        {!lo && <><FilterField label="Status absensi"><select value={status} onChange={(e) => setParam('status', e.target.value)}>
          <option value="">Semua status{counts ? ` (${counts.total})` : ''}</option>
          <option value="review">Perlu dicek{counts ? ` (${counts.review})` : ''}</option>
          <option value="valid">Valid{counts ? ` (${counts.valid})` : ''}</option>
          <option value="ditolak">Ditolak{counts ? ` (${counts.ditolak})` : ''}</option>
          <option value="berhalangan">Mundur/Berhalangan Hadir{counts ? ` (${counts.berhalangan})` : ''}</option>
        </select></FilterField>
        <FilterField label="Urutkan"><select aria-label="Urutkan absensi" value={sort} onChange={(e) => setParam('sort', e.target.value)}>
          <option value="risk">Prioritas pemeriksaan</option>
          <option value="newest">Waktu terbaru</option>
          <option value="oldest">Waktu terlama</option>
          <option value="name_asc">Nama A–Z</option>
          <option value="name_desc">Nama Z–A</option>
          <option value="venue_asc">Venue A–Z</option>
          <option value="venue_desc">Venue Z–A</option>
        </select></FilterField></>}
        <button className="btn btn--sm" onClick={load}><Icon name="refresh" size={15} />Muat ulang</button>
        {!lo && sid && <button type="button" className="btn btn--sm" disabled={loading} onClick={() => setDownloadOpen(true)}>
          <Icon name="download" size={15} />Unduh
        </button>}
      </div>
      {loadError && <p className="alert alert--err" role="alert">{loadError}</p>}
      <div className="tabs">
        <button className={tab === 'absen' ? 'on' : ''} onClick={() => setTab('absen')}>Absensi masuk ({loading ? '…' : total})</button>
        {!lo && <button className={tab === 'blok' ? 'on' : ''} onClick={() => setTab('blok')}>Percobaan diblokir ({attempts.length})</button>}
      </div>

      {tab === 'absen' && noteNotice && <p className="alert alert--ok" role="status">{noteNotice}</p>}
      {tab === 'absen' && deleteNotice && <p className="alert alert--ok" role="status">{deleteNotice}</p>}
      {tab === 'absen' && loading && !rows.length && <div className="grid attendance-grid"><SkelCards n={4} h={200} /></div>}
      {tab === 'absen' && (
        <div className="grid attendance-grid" style={loading && rows.length ? { opacity: 0.5, transition: 'opacity .2s' } : undefined}>
          {rows.map((r) => (
            <div key={r.id} className={`rec rec--${r.status}`}>
              <div>
                {!r.has_photo
                  ? <div className="rec__qr"><Icon name={r.status === 'berhalangan' ? 'clock' : r.method === 'qr' ? 'qr' : 'users'} size={40} />
                    <b>{r.status === 'berhalangan' ? ST_LABEL.berhalangan : r.method === 'qr' ? 'Scan QR' : 'Diabsenkan LO'}</b><small>{personName(r.scanned_by) || 'LO / panitia'}</small></div>
                  : <img src={r.photo_url || adminUrl(`/photo/${r.id}`)} alt={personName(r.name)} loading="lazy" title="Klik untuk memperbesar"
                    onClick={() => setZoom(r.photo_url || adminUrl(`/photo/${r.id}`))} />}
              </div>
              <div className="rec__body">
                <div className="rec__status-bar">
                  <span>Status absensi</span>
                  <span className={`rec__status-chip rec__status-chip--${r.status}`}>
                    <Icon name={r.status === 'valid' ? 'check' : r.status === 'ditolak' ? 'x' : r.status === 'review' ? 'alert' : 'clock'} size={15} />
                    {ST_LABEL[r.status] || r.status}
                  </span>
                </div>
                {r.method === 'manual' && r.has_photo && <span className="rec__by"><Icon name="users" size={13} /> Diabsenkan {personName(r.scanned_by) || 'LO'}</span>}
                <div className="rec__name">{personName(r.representative?.name || r.name)} <span className={`tag tag--${r.role}`}>{r.role}</span>
                  {r.representative?.name && <span className="tag tag--venue">Mewakili</span>}</div>
                {r.representative?.name && <div className="muted small">Mewakili {personName(r.name)}</div>}
                <div className="muted small">{r.code} · {r.institution || '-'}</div>
                {r.venue_name && <div><span className="tag tag--venue">{r.venue_name}</span></div>}
                {r.lat == null ? <div className="small">{fmtDT(r.created_at)} WIB · {r.status === 'berhalangan' ? 'dicatat oleh' : r.method === 'qr' ? 'dipindai oleh' : 'diabsenkan oleh'} {personName(r.scanned_by) || 'LO'}</div> : <>
                <div className="small">{fmtDT(r.created_at)} WIB · {dist(r.distance_m)} dari venue · akurasi ±{Math.round(r.accuracy_m)} m</div>
                <div className="rec__geo">{Number(r.lat).toFixed(6)}, {Number(r.lng).toFixed(6)}</div>
                <button type="button" className="link-btn" onClick={() => setMapPoint({
                  lat: r.lat, lng: r.lng, title: `${personName(r.name)} — ${r.venue_name || 'lokasi absen'}`,
                  rows: [['Waktu', fmtDT(r.created_at) + ' WIB'], ['Venue', r.venue_name], ['Jarak ke venue', dist(r.distance_m)],
                    ['Akurasi GPS', `±${Math.round(r.accuracy_m)} m`], ['Status', ST_LABEL[r.status]]],
                })}><Icon name="pin" size={14} />Lihat di peta</button></>}
                {!/^(lo(?:\s|$)|liaison officer$)/i.test(String(r.position || '').trim()) && r.flags.some((f) => f.code !== 'qr_lo') && (
                  <ul className="flags">
                    {r.flags.filter((f) => f.code !== 'qr_lo').map((f, i) => <li key={i} title={f.detail}>{FLAG_LABEL[f.code] || f.code}<br /><small>{f.detail}</small></li>)}
                  </ul>
                )}
                {(r.participant_note || r.status === 'berhalangan') && <div className="rec__note small"><b>{r.status === 'berhalangan' ? 'Alasan berhalangan hadir' : 'Catatan'}</b><div>{r.participant_note || 'Belum dicatat'}</div></div>}
                {!!r.photo_history?.length && <details className="attendance-photo-history">
                  <summary>Riwayat foto ({r.photo_history.length})</summary>
                  {r.photo_history.map((version,index) => <figure key={index}>
                    {version.has_photo && <img src={adminUrl(`/photo/${r.id}?version=${index}`)} loading="lazy"
                      alt={`Foto absensi sebelumnya ${personName(r.name)}, percobaan ${index+1}`}
                      onClick={() => setZoom(adminUrl(`/photo/${r.id}?version=${index}`))} />}
                    <figcaption>{fmtDT(version.at)} WIB · {ST_LABEL[version.status] || version.status}</figcaption>
                  </figure>)}
                </details>}
                <div className="row">
                  {r.can_edit_note && r.role !== 'panitia' && <button type="button" className="btn btn--sm" disabled={loading}
                    onClick={() => { setNoteNotice(''); setNoteTarget(r); }}>{r.status === 'berhalangan' ? 'Ubah alasan' : 'Ubah catatan'}</button>}
                  {lo && r.status === 'ditolak' && r.can_retry && <button type="button" className="btn btn--sm btn--primary"
                    disabled={loading || !selectedSession?.is_open} title={selectedSession?.is_open ? 'Ambil foto baru untuk absen ulang' : 'Sesi absensi sudah ditutup'}
                    onClick={() => setRetryTarget({ code: r.code, name: personName(r.representative?.name || r.name), originalName: r.representative?.name ? r.name : null, position: r.position, school: r.institution,
                      sessionId: Number(sid), sessionName: sessionTitle(selectedSession), isTest: selectedSession?.is_test })}>Absen ulang</button>}
                  {r.status !== 'berhalangan' && r.can_verify !== false && <>
                    {!lo && r.status !== 'valid' && <button className="btn btn--sm btn--ok" onClick={() => setStatus(r.id, 'valid')}>Sahkan</button>}
                    {r.status !== 'ditolak' && <button className="btn btn--sm btn--danger" onClick={() => setStatus(r.id, 'ditolak')}>Tolak</button>}
                  </>}
                  {r.can_delete && <button type="button" className="btn btn--sm btn--danger" disabled={loading}
                    aria-label={`Hapus absensi ${personName(r.name)}`} title="Hapus absensi" onClick={() => openDeleteDialog(r)}><Icon name="trash" size={16} /></button>}
                </div>
              </div>
            </div>
          ))}
          {!rows.length && !loading && !loadError && <p className="muted">Belum ada data.</p>}
        </div>
      )}
      {tab === 'absen' && pages > 1 && (
        <div className="pager">
          <button className="btn btn--sm" disabled={page <= 1 || loading} onClick={() => setParam('hal', String(page - 1))}><Icon name="left" size={15} />Sebelumnya</button>
          <span className="muted small">Halaman <b>{page}</b> dari {pages} · {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} dari {total}</span>
          <button className="btn btn--sm" disabled={page >= pages || loading} onClick={() => setParam('hal', String(page + 1))}>Berikutnya<Icon name="right" size={15} /></button>
        </div>
      )}

      {tab === 'blok' && (
        <>
        {recordedBy && <p className="muted small">Filter LO pencatat berlaku untuk absensi masuk dan CSV. Percobaan diblokir tidak memiliki data LO pencatat.</p>}
        <table className="table stack-table" role="table" aria-label="Percobaan absensi diblokir">
          <thead><tr><th>Waktu</th><th>Nama</th><th>Alasan</th><th>Jarak</th><th>Peta</th></tr></thead>
          <tbody>
            {attempts.map((a) => (
              <tr key={a.id} role="row">
                <td role="cell" data-label="Waktu" className="small">{fmtDT(a.created_at)}</td>
                <td role="cell" data-label="Peserta" className="stack-full">{personName(a.name)} <span className="muted small">{a.code}</span></td>
                <td role="cell" data-label="Alasan" className="small stack-full">{a.reasons.join(' ')}</td>
                <td role="cell" data-label="Jarak">{dist(a.distance_m)}</td>
                <td role="cell">{a.lat != null && (
                  <button type="button" className="link-btn" onClick={() => setMapPoint({
                    lat: a.lat, lng: a.lng, title: `${a.name || 'Percobaan'} — diblokir`,
                    rows: [['Waktu', fmtDT(a.created_at) + ' WIB'], ['Venue terdekat', a.venue_name], ['Jarak', dist(a.distance_m)],
                      ['Akurasi GPS', a.accuracy_m != null ? `±${Math.round(a.accuracy_m)} m` : null], ['Alasan', a.reasons.join(' ')]],
                  })}><Icon name="pin" size={14} />peta</button>)}</td>
              </tr>
            ))}
            {!attempts.length && <tr><td colSpan={5} className="muted">Tidak ada.</td></tr>}
          </tbody>
        </table>
        </>
      )}

      {retryTarget && <Suspense fallback={<p role="status">Memuat kamera…</p>}><RetryPhoto target={retryTarget} user={user} busy={retryBusy}
        onSend={retryAttendance} onClose={() => { if (!retryBusy) setRetryTarget(null); }} /></Suspense>}
      {downloadOpen && <AttendanceDownloadDialog sessions={sessions} venues={venues} lo={lo}
        initial={{ session_id: String(sid), venue_id: venue, recorded_by: recordedBy, position, status, q: search }} onClose={() => setDownloadOpen(false)} />}
      <dialog ref={deleteDialog} className="assignment-dialog" aria-labelledby="delete-attendance-title"
        aria-describedby="delete-attendance-description" onCancel={(event) => { if (deleting) event.preventDefault(); }}>
        <header><h3 id="delete-attendance-title">Hapus absensi</h3></header>
        <p id="delete-attendance-description">Catatan absensi <strong>{personName(deleteTarget?.name)}</strong> pada sesi ini akan dihapus permanen.</p>
        <form className="form" onSubmit={deleteAttendance}>
          <label>
            Ketik persis “{DELETE_CONFIRMATION}”
            <input autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} required disabled={deleting}
              value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          </label>
          {deleteError && <div className="alert alert--err" role="alert">{deleteError}</div>}
          <div className="row">
            <button type="button" className="btn" disabled={deleting} onClick={() => deleteDialog.current.close()}>Batal</button>
            <button type="submit" className="btn btn--danger" disabled={deleting || confirmation !== DELETE_CONFIRMATION}>
              {deleting ? 'Menghapus…' : 'Hapus absensi'}
            </button>
          </div>
        </form>
      </dialog>
      {noteTarget && <EditAttendanceNote key={noteTarget.id} target={noteTarget} onClose={() => setNoteTarget(null)}
        onSaved={(updated) => { setRows((current) => current.map((row) => row.id === updated.id ? { ...row, ...updated } : row));
          setNoteNotice('Catatan berhasil diperbarui.'); }} />}
      {zoom && <div className="modal" onClick={() => setZoom(null)}><img src={zoom} alt="" /></div>}
      <MapModal point={mapPoint} onClose={() => setMapPoint(null)} />
    </>
  );
}
