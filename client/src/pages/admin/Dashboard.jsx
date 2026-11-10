import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api, adminUrl } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { useVisiblePolling } from '../../lib/poll.js';
import { fmtDT } from './shared.js';
import { Skel, SkelCards } from '../../components/Skeleton.jsx';
import AttendanceDetailDialog from './AttendanceDetailDialog.jsx';

const number = new Intl.NumberFormat('id-ID');
const venueGroups = [
  ['bendahara', 'Bendahara (sekolah)'], ['pengawas', 'Pengawas'],
  ['fasil', 'Fasilitator'], ['dinas', 'Dinas Pendidikan'],
  ['bpmp', 'BB/BPMP'], ['lo', 'LO'],
];

function VenueAttendanceCard({ venue, onDetails }) {
  const participantGroups = venueGroups.filter(([key]) => key !== 'lo');
  const total = participantGroups.reduce((sum, [key]) => sum + venue[key].total, 0);
  const attended = participantGroups.reduce((sum, [key]) => sum + venue[key].attended, 0);

  return (
    <article className="venue-attendance">
      <header className="venue-attendance__head">
        <span className="kpi__icon"><Icon name="pin" size={20} /></span>
        <div>
          <h4>{venue.name}</h4>
          <div className="muted small"><b>{number.format(attended)}</b> dari {number.format(total)} peserta sudah absen</div>
          <div className="muted small">{number.format(venue.lo.total)} LO tercatat terpisah</div>
        </div>
      </header>
      <div className="venue-attendance__groups">
        {venueGroups.map(([key, label]) => {
          const { total, attended, registered } = venue[key];
          return (
            <button type="button" key={key} aria-haspopup="dialog" aria-label={`Lihat daftar ${label} di ${venue.name}`}
              onClick={() => onDetails({ label, subtitle: venue.name, path: `/admin/venue-attendance/${venue.id}/${key}` })}>
              <span className="venue-attendance__label">{label}</span>
              <span className="venue-attendance__count"><b>{number.format(attended)}</b> / {number.format(total)} <small>sudah absen</small></span>
              {registered < total && <small className="muted">
                {registered === 0 ? 'Belum ada profil absensi' : `${number.format(registered)} punya profil absensi`}
              </small>}
            </button>
          );
        })}
      </div>
    </article>
  );
}

export default function Dashboard() {
  const { user, lo } = useOutletContext() || {};
  const [data, setSessions] = useState(null);
  const sessions = data || [];
  const loading = !data;
  const [venues, setVenues] = useState(null);
  const [venueId, setVenueId] = useState(''); // filter venue (admin utama)
  const [venueAttendance, setVenueAttendance] = useState(null);
  const [summaryError, setSummaryError] = useState(false);
  const [details, setDetails] = useState(null);

  useEffect(() => { api('/admin/venues', { admin: true }).then(setVenues); }, []);

  const qs = !lo && venueId ? `?venue_id=${venueId}` : '';
  // Diperbarui tiap 30 detik, hanya saat tab ini sedang dilihat
  useVisiblePolling(() => api(`/admin/sessions${qs}`, { admin: true }).then(setSessions).catch(() => {}), 30_000, [qs]);
  useVisiblePolling(() => api('/admin/venue-attendance', { admin: true })
    .then((rows) => { setVenueAttendance(rows); setSummaryError(false); })
    .catch(() => setSummaryError(true)), 30_000);

  const open = sessions.filter((s) => s.is_open);
  const sum = (k) => open.reduce((a, s) => a + s[k], 0);
  const activeVenues = venues?.filter((v) => v.active).length ?? 0;
  const venueQs = (sid) => `/export?session_id=${sid}${!lo && venueId ? `&venue_id=${venueId}` : ''}`;
  const shownVenues = (venueAttendance || []).filter((venue) => !venueId || String(venue.id) === venueId);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Rekap Kehadiran{lo && user?.venue ? ` — ${user.venue.name}` : ''}</h2>
          <p className="muted">Diperbarui otomatis tiap 30 detik selama halaman ini terbuka.</p>
        </div>
        {!lo && venues?.length > 1 && (
          <select aria-label="Filter venue" value={venueId} onChange={(e) => setVenueId(e.target.value)} style={{ width: 'auto', minWidth: 220 }}>
            <option value="">Semua venue</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
      </div>
      {!lo && venues && activeVenues === 0 && (
        <div className="alert alert--warn" style={{ marginBottom: 16 }}><Icon name="alert" size={18} />
          <span>Aktifkan venue sebelum membuka absensi mandiri. <Link to="/admin/venue">Kelola venue</Link></span>
        </div>
      )}

      <div className="kpis">
        <div className="kpi"><span className="kpi__icon"><Icon name="calendar" /></span><span><b>{loading ? <Skel w={40} h={26} /> : open.length}</b><small>Sesi sedang dibuka</small></span></div>
        <div className="kpi"><span className="kpi__icon"><Icon name="check" /></span><span><b>{loading ? <Skel w={56} h={26} /> : sum('valid') + sum('review')}</b><small>Hadir di sesi aktif</small></span></div>
        <div className="kpi"><span className="kpi__icon"><Icon name="alert" /></span><span><b>{loading ? <Skel w={40} h={26} /> : sum('review')}</b><small>Perlu dicek</small></span></div>
        {lo
          ? <div className="kpi"><span className="kpi__icon"><Icon name="pin" /></span><span><b style={{ fontSize: 16 }}>{user?.venue?.name}</b><small>Venue Anda</small></span></div>
          : <div className="kpi"><span className="kpi__icon"><Icon name="pin" /></span><span><b>{!venues ? <Skel w={30} h={26} /> : activeVenues}</b><small>Venue aktif</small></span></div>}
      </div>

      <section className="venue-attendance-section" aria-labelledby="venue-attendance-title">
        <h3 id="venue-attendance-title">Ringkasan per venue</h3>
        <p className="muted small">Akumulasi semua sesi. Setiap profil dengan absensi valid atau perlu dicek dihitung sekali per venue. Kartu sesi di bawah menghitung kehadiran untuk sesi tersebut.</p>
        {summaryError && <p className="alert alert--warn" role="status">Ringkasan venue gagal diperbarui.</p>}
        {!venueAttendance && !summaryError && <div className="stats"><SkelCards n={2} h={190} /></div>}
        {venueAttendance && !shownVenues.length && <p className="muted">Belum ada venue untuk ditampilkan.</p>}
        <div className="venue-attendance-grid">
          {shownVenues.map((venue) => <VenueAttendanceCard key={venue.id} venue={venue} onDetails={setDetails} />)}
        </div>
      </section>
      <AttendanceDetailDialog details={details} onClose={() => setDetails(null)} />

      {loading && <div className="stats"><SkelCards n={3} h={170} /></div>}
      {!loading && !sessions.length && <p className="muted">Belum ada sesi{!lo && <> — <Link to="/admin/sesi">buat sesi</Link></>}.</p>}
      <div className="stats">
        {sessions.map((s) => {
          const hadir = s.valid + s.review;
          const pct = s.expected ? Math.round((hadir / s.expected) * 100) : 0;
          return (
            <div key={s.id} className={`stat ${s.is_open ? 'stat--open' : ''}`}>
              <div className="stat__head">
                <b>{s.name}</b>
                <span className={`tag tag--${s.role}`}>{s.role}</span>
                <span className="tag tag--type">{s.type}</span>
                {s.is_open && <span className="tag tag--open">● Dibuka</span>}
              </div>
              <div className="muted small">{fmtDT(s.starts_at)} – {fmtDT(s.ends_at)} WIB</div>
              <div className="stat__big">{hadir}<small> / {s.expected} hadir ({pct}%)</small></div>
              <div className="bar"><span style={{ width: `${Math.min(pct, 100)}%` }} /></div>
              <div className="stat__row">
                <span>✓ Valid {s.valid}</span>
                <span className={s.review ? 'warn' : ''}>⚠ Perlu cek {s.review}</span>
                <span>✕ Ditolak {s.rejected}</span>
                {s.unavailable > 0 && <span>Berhalangan {s.unavailable}</span>}
                <span title="Percobaan diblokir otomatis oleh pemeriksaan lokasi">⛔ Diblokir {s.blocked}</span>
              </div>
              {!lo && s.by_venue.length > 0 && (
                <div className="chips">
                  {s.by_venue.map((v) => <span key={v.name} className="tag tag--venue">{v.name}: {v.n}</span>)}
                </div>
              )}
              <div className="row">
                <Link className="btn btn--sm" to={`/admin/absensi?sesi=${s.id}${s.review ? '&status=review' : ''}`}><Icon name="list" size={15} />Verifikasi</Link>
                <a className="btn btn--sm" href={adminUrl(venueQs(s.id))}><Icon name="download" size={15} />CSV</a>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
