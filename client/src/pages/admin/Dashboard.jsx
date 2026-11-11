import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api, adminUrl } from '../../api.js';
import FontIcon from '../../components/FontIcon.jsx';
import { useVisiblePolling } from '../../lib/poll.js';
import { checkInDayLabel, fmtDT, sessionTitle } from './shared.js';
import { Skel, SkelCards } from '../../components/Skeleton.jsx';
import AttendanceDetailDialog from './AttendanceDetailDialog.jsx';

const number = new Intl.NumberFormat('id-ID');
const sessionStatuses = [
  ['valid', 'Valid', 'circle-check'], ['review', 'Perlu dicek', 'triangle-exclamation'],
  ['rejected', 'Ditolak', 'circle-xmark'], ['unavailable', 'Berhalangan', 'user-slash'], ['blocked', 'Diblokir', 'ban'],
];
const venueGroups = [
  ['bendahara', 'Bendahara (sekolah)'], ['pengawas', 'Pengawas'],
  ['fasil', 'Fasilitator'], ['dinas', 'Dinas Pendidikan'],
  ['bpmp', 'BB/BPMP'], ['lo', 'LO'],
];

function VenueAttendanceCard({ venue, day, onDetails }) {
  const participantGroups = venueGroups.filter(([key]) => key !== 'lo');
  const total = participantGroups.reduce((sum, [key]) => sum + venue[key].total, 0);
  const attended = participantGroups.reduce((sum, [key]) => sum + venue[key].attended, 0);

  return (
    <article className="venue-attendance">
      <header className="venue-attendance__head">
        <span className="kpi__icon"><FontIcon name="location-dot" /></span>
        <div>
          <h4>{venue.name}</h4>
          <div className="muted small"><b>{number.format(attended + venue.lo.attended)}</b> dari {number.format(total + venue.lo.total)} orang sudah absen</div>
          <div className="muted small">{number.format(total)} peserta dan {number.format(venue.lo.total)} LO</div>
        </div>
      </header>
      <div className="venue-attendance__groups">
        {venueGroups.map(([key, label]) => {
          const { total, attended, registered } = venue[key];
          return (
            <button type="button" key={key} aria-haspopup="dialog" aria-label={`Lihat daftar ${label} di ${venue.name}`}
              onClick={() => onDetails({
                label, subtitle: [venue.name, day && checkInDayLabel(day)].filter(Boolean).join(' · '),
                path: `/admin/venue-attendance/${venue.id}/${key}${day ? `?day=${day.date}` : ''}`,
                sessionDay: day && checkInDayLabel(day),
                filterByCheckIn: true,
              })}>
              <span className="venue-attendance__label">{label} <FontIcon name="chevron-right" /></span>
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
  const [days, setDays] = useState([]);
  const [day, setDay] = useState('');
  const [venueAttendance, setVenueAttendance] = useState(null);
  const [summaryError, setSummaryError] = useState(false);
  const [details, setDetails] = useState(null);

  useEffect(() => {
    api('/admin/venues', { admin: true }).then(setVenues);
    api('/info').then((info) => setDays(info.check_in_days || [])).catch(() => {});
  }, []);

  const dayQs = day ? `?day=${day}` : '';
  const qs = `?official=1${day ? `&day=${day}` : ''}${!lo && venueId ? `&venue_id=${venueId}` : ''}`;
  const requestScope = useRef({ qs, dayQs });
  requestScope.current = { qs, dayQs };
  // Diperbarui tiap 30 detik, hanya saat tab ini sedang dilihat
  useVisiblePolling(() => api(`/admin/sessions${qs}`, { admin: true })
    .then((rows) => { if (requestScope.current.qs === qs) setSessions(rows); }).catch(() => {}), 30_000, [qs]);
  useVisiblePolling(() => api(`/admin/venue-attendance${dayQs}`, { admin: true })
    .then((rows) => { if (requestScope.current.dayQs === dayQs) { setVenueAttendance(rows); setSummaryError(false); } })
    .catch(() => { if (requestScope.current.dayQs === dayQs) setSummaryError(true); }), 30_000, [dayQs]);

  const open = sessions.filter((s) => s.is_open);
  const sum = (k) => open.reduce((a, s) => a + s[k], 0);
  const activeVenues = venues?.filter((v) => v.active).length ?? 0;
  const venueQs = (sid) => `/export?session_id=${sid}${!lo && venueId ? `&venue_id=${venueId}` : ''}`;
  const shownVenues = (venueAttendance || []).filter((venue) => !venueId || String(venue.id) === venueId);
  const selectedDay = days.find((item) => item.date === day);

  return (
    <div className="attendance-dashboard">
      <div className="page-head">
        <div>
          <h2>Rekap Absensi{lo && user?.venue ? ` — ${user.venue.name}` : ''}</h2>
          <p className="muted">Catatan absensi di aplikasi. Data diperbarui otomatis tiap 30 detik.</p>
        </div>
        <div className="row dashboard-filters">
          {days.length > 0 && <select aria-label="Hari absensi" value={day} onChange={(e) => {
            setDay(e.target.value); setSessions(null); setVenueAttendance(null); setSummaryError(false);
          }}>
            <option value="">Semua sesi resmi</option>
            {days.map((item) => <option key={item.date} value={item.date}>{checkInDayLabel(item)}</option>)}
          </select>}
          {!lo && venues?.length > 1 && <select aria-label="Filter venue" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
            <option value="">Semua venue</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>}
        </div>
      </div>
      {!lo && venues && activeVenues === 0 && (
        <div className="alert alert--warn" style={{ marginBottom: 16 }}><FontIcon name="triangle-exclamation" />
          <span>Aktifkan venue sebelum membuka sesi untuk LO. <Link to="/admin/venue">Kelola venue</Link></span>
        </div>
      )}

      <div className="kpis">
        <div className="kpi"><span className="kpi__icon"><FontIcon name="calendar-days" /></span><span><b>{loading ? <Skel w={40} h={26} /> : open.length}</b><small>Sesi sedang dibuka</small></span></div>
        <div className="kpi"><span className="kpi__icon"><FontIcon name="circle-check" /></span><span><b>{loading ? <Skel w={56} h={26} /> : sum('valid') + sum('review')}</b><small>Sudah absen di sesi aktif</small></span></div>
        <div className="kpi"><span className="kpi__icon"><FontIcon name="triangle-exclamation" /></span><span><b>{loading ? <Skel w={40} h={26} /> : sum('review')}</b><small>Perlu dicek</small></span></div>
        {lo
          ? <div className="kpi"><span className="kpi__icon"><FontIcon name="location-dot" /></span><span><b style={{ fontSize: 16 }}>{user?.venue?.name}</b><small>Venue Anda</small></span></div>
          : <div className="kpi"><span className="kpi__icon"><FontIcon name="location-dot" /></span><span><b>{!venues ? <Skel w={30} h={26} /> : activeVenues}</b><small>Venue aktif</small></span></div>}
      </div>

      <div className={`dashboard-overview${lo || venueId ? ' dashboard-overview--single' : ''}`}>
      <section className="dashboard-sessions" aria-labelledby="dashboard-sessions-title">
      <h3 id="dashboard-sessions-title">Absensi per sesi</h3>
      <p className="muted small">Lihat jumlah yang sudah absen dibandingkan target tiap sesi.</p>
      {loading && <div className="stats"><SkelCards n={3} h={170} /></div>}
      {!loading && !sessions.length && <p className="muted">Belum ada sesi{!lo && <> — <Link to="/admin/sesi">buat sesi</Link></>}.</p>}
      <div className="stats">
        {sessions.map((s) => {
          const checkedIn = s.valid + s.review;
          const pct = s.expected ? Math.round((checkedIn / s.expected) * 100) : 0;
          return (
            <div key={s.id} className={`stat ${s.is_open ? 'stat--open' : ''}`}>
              <div className="stat__head">
                <h4>{sessionTitle(s)}</h4>
                {s.is_open && <span className="tag tag--open"><FontIcon name="circle-play" /> Dibuka</span>}
              </div>
              <div className="muted small"><FontIcon name="clock" /> {fmtDT(s.starts_at)} – {fmtDT(s.ends_at)} WIB</div>
              <div className="chips"><span className={`tag tag--${s.role}`}>{s.role}</span>
                {!s.check_in_day && <span className="tag tag--type">{s.type}</span>}</div>
              <div className="stat__big">{number.format(checkedIn)}<small> / {number.format(s.expected)} sudah absen</small><strong>{pct}%</strong></div>
              <div className="bar"><span style={{ width: `${Math.min(pct, 100)}%` }} /></div>
              <dl className="dashboard-statuses">
                {sessionStatuses.filter(([key]) => key !== 'unavailable' || s.unavailable > 0).map(([key, label, icon]) => (
                  <div key={key} data-status={key}><dt><FontIcon name={icon} /> {label}</dt><dd>{number.format(s[key])}</dd></div>
                ))}
              </dl>
              {!lo && s.by_venue.length > 0 && (
                <div className="chips">
                  {s.by_venue.map((v) => <span key={v.name} className="tag tag--venue">{v.name}: {v.n}</span>)}
                </div>
              )}
              <div className="row">
                <Link className="btn btn--sm" to={`/admin/absensi?sesi=${s.id}${s.review ? '&status=review' : ''}`}><FontIcon name="list-check" />Verifikasi</Link>
                <a className="btn btn--sm" href={adminUrl(venueQs(s.id))}><FontIcon name="download" />Unduh CSV</a>
              </div>
            </div>
          );
        })}
      </div>
      </section>
      <section className="venue-attendance-section" aria-labelledby="venue-attendance-title">
        <h3 id="venue-attendance-title">Ringkasan per venue</h3>
        <p className="muted small">{selectedDay ? `Ringkasan ${checkInDayLabel(selectedDay)}.` : 'Gabungan semua sesi resmi.'} Setiap orang dihitung sekali per venue.</p>
        {summaryError && <p className="alert alert--warn" role="status">Ringkasan venue gagal diperbarui.</p>}
        {!venueAttendance && !summaryError && <div className="stats"><SkelCards n={2} h={190} /></div>}
        {venueAttendance && !shownVenues.length && <p className="muted">Belum ada venue untuk ditampilkan.</p>}
        <div className="venue-attendance-grid">
          {shownVenues.map((venue) => <VenueAttendanceCard key={venue.id} venue={venue} day={selectedDay} onDetails={setDetails} />)}
        </div>
      </section>
      </div>
      <AttendanceDetailDialog details={details} onClose={() => setDetails(null)} />
    </div>
  );
}
