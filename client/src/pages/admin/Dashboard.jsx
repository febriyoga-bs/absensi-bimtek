import FilterField from '../../components/FilterField.jsx';
import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api, adminUrl } from '../../api.js';
import FontIcon from '../../components/FontIcon.jsx';
import { checkInDayLabel, fmtDT, sessionTitle } from './shared.js';
import { Skel, SkelCards } from '../../components/Skeleton.jsx';
import AttendanceDetailDialog from './AttendanceDetailDialog.jsx';
import { venueAttendanceGroups as venueGroups } from '../../lib/venueAttendanceGroups.js';
import { useEvents } from '../../components/EventScope.jsx';

const number = new Intl.NumberFormat('id-ID');
const sessionStatuses = [
  ['valid', 'Valid', 'circle-check'], ['review', 'Perlu dicek', 'triangle-exclamation'],
  ['rejected', 'Ditolak', 'circle-xmark'], ['unavailable', 'Berhalangan', 'user-slash'], ['blocked', 'Diblokir', 'ban'],
];

function VenueAttendanceCard({ venue, day, testSession, onDetails, visibleGroups }) {
  const participantGroups = visibleGroups.filter(([key]) => key !== 'lo');
  const total = participantGroups.reduce((sum, [key]) => sum + venue[key].total, 0);
  const attended = participantGroups.reduce((sum, [key]) => sum + venue[key].attended, 0);

  return (
    <article className="venue-attendance">
      <header className="venue-attendance__head">
        <span className="kpi__icon"><FontIcon name="location-dot" /></span>
        <div>
          <h4>{venue.name}</h4>
          <div className="muted small"><b>{number.format(attended + (visibleGroups.some(([key]) => key === 'lo') ? venue.lo.attended : 0))}</b> dari {number.format(total + (visibleGroups.some(([key]) => key === 'lo') ? venue.lo.total : 0))} orang sudah absen</div>
          <div className="muted small">{number.format(total)} peserta{visibleGroups.some(([key]) => key === 'lo') && ` dan ${number.format(venue.lo.total)} LO`}</div>
        </div>
      </header>
      <div className="venue-attendance__groups">
        {visibleGroups.map(([key, label]) => {
          const { total, attended, registered } = venue[key];
          return (
            <button type="button" key={key} aria-haspopup="dialog" aria-label={`Lihat daftar ${label} di ${venue.name}`}
              onClick={() => onDetails({
                label, subtitle: [venue.name, testSession ? sessionTitle(testSession) : day && checkInDayLabel(day)].filter(Boolean).join(' · '),
                path: `/admin/venue-attendance/${venue.id}/${key}${testSession ? `?test_session_id=${testSession.id}` : day ? `?day=${day.date}` : ''}`,
                sessionDay: testSession ? sessionTitle(testSession) : day && checkInDayLabel(day),
                filterByCheckIn: true,
                sourceTotal: venue[key].source === 'arrival' ? total : undefined,
              })}>
              <span className="venue-attendance__label">{label} <FontIcon name="chevron-right" /></span>
              <span className="venue-attendance__count"><b>{number.format(attended)}</b> / {number.format(total)} <small>sudah absen</small></span>
              {venue[key].source !== 'arrival' && registered < total && <small className="muted">
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
  const { event } = useEvents() || {};
  const [data, setSessions] = useState(null);
  const sessions = data || [];
  const loading = !data;
  const [venues, setVenues] = useState(null);
  const [venueId, setVenueId] = useState(''); // filter venue (admin utama)
  const [days, setDays] = useState([]);
  const [testSessions, setTestSessions] = useState([]);
  const [day, setDay] = useState(null);
  const [venueAttendance, setVenueAttendance] = useState(null);
  const [summaryError, setSummaryError] = useState(false);
  const [sessionsError, setSessionsError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [details, setDetails] = useState(null);
  const [hiddenGroups, setHiddenGroups] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('bimtek-venue-hidden-groups') || '[]');
      return Array.isArray(saved) ? saved.filter((key) => venueGroups.some(([group]) => group === key)) : [];
    } catch { return []; }
  });
  const visibleGroups = venueGroups.filter(([key]) => !hiddenGroups.includes(key));
  useEffect(() => {
    try { localStorage.setItem('bimtek-venue-hidden-groups', JSON.stringify(hiddenGroups)); } catch { /* storage unavailable */ }
  }, [hiddenGroups]);

  useEffect(() => {
    api('/admin/venues', { admin: true }).then(setVenues);
    api('/admin/sessions?test_only=1', { admin: true }).then(setTestSessions).catch(() => setSessionsError(true));
    api('/info').then((info) => {
      const available = info.check_in_days || [];
      const today = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
      setDays(available);
      const dates = available.map((item) => item.date).sort();
      // Default to today's reporting day, otherwise the nearest past day.
      // An empty selection remains an explicit choice to combine all days.
      setDay(dates.includes(today) ? today : dates.filter((date) => date <= today).at(-1) || dates[0] || '');
    }).catch(() => { setSessionsError(true); setSummaryError(true); });
  }, []);

  const testId = day?.startsWith('test:') ? day.slice(5) : '';
  const selectedTest = testSessions.find((session) => String(session.id) === testId);
  const dayQs = testId ? `?test_session_id=${testId}` : day ? `?day=${day}` : '';
  const qs = `?${testId ? 'test_only=1' : 'official=1'}${day && !testId ? `&day=${day}` : ''}${!lo && venueId ? `&venue_id=${venueId}` : ''}`;
  useEffect(() => {
    if (day === null) return;
    let active = true;
    setSessionsError(false);
    api(`/admin/sessions${qs}`, { admin: true })
      .then((rows) => { if (active) setSessions(testId ? rows.filter((session) => String(session.id) === testId) : rows); })
      .catch(() => { if (active) setSessionsError(true); });
    return () => { active = false; };
  }, [qs, revision, day]);
  useEffect(() => {
    if (day === null) return;
    let active = true;
    setSummaryError(false);
    setVenueAttendance(null);
    api(`/admin/venue-attendance${dayQs}`, { admin: true })
      .then((rows) => { if (active) setVenueAttendance(rows); })
      .catch(() => { if (active) setSummaryError(true); });
    return () => { active = false; };
  }, [dayQs, revision, day]);

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
          <p className="muted">Klik Muat ulang atau reload browser untuk memperbarui data absensi.</p>
        </div>
        <div className="row dashboard-filters">
          <button type="button" className="btn" onClick={() => setRevision((value) => value + 1)}>Muat ulang</button>
          {(days.length > 0 || testSessions.length > 0) && <FilterField label="Hari / sesi absensi"><select aria-label="Hari absensi" value={day ?? ''} onChange={(e) => {
            setDay(e.target.value); setSessions(null); setVenueAttendance(null); setSummaryError(false);
          }}>
            <option value="">Semua sesi resmi</option>
            {days.map((item) => <option key={item.date} value={item.date}>{checkInDayLabel(item)}</option>)}
            {testSessions.length > 0 && <optgroup label="Sesi test">{testSessions.map((session) => <option key={session.id} value={`test:${session.id}`}>{sessionTitle(session)} (Test)</option>)}</optgroup>}
          </select></FilterField>}
          {!lo && venues?.length > 1 && <FilterField label="Filter venue"><select aria-label="Filter venue" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
            <option value="">Semua venue</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></FilterField>}
        </div>
      </div>
      {lo && user?.venue && venues?.some((venue) => venue.id === user.venue.id && venue.in_event === false) && (
        <p className="alert alert--warn" role="status">
          Venue {user.venue.name} tidak termasuk venue {event?.name || 'BIMTEK pada tahap ini'}. Rekap absensi untuk venue ini tidak tersedia pada tahap yang dipilih.
        </p>
      )}
      {!lo && venues && activeVenues === 0 && (
        <div className="alert alert--warn" style={{ marginBottom: 16 }}><FontIcon name="triangle-exclamation" />
          <span>Aktifkan venue sebelum membuka sesi untuk LO. <Link to="/admin/venue">Kelola venue</Link></span>
        </div>
      )}

      <div className="kpis">
        <div className="kpi"><span className="kpi__icon"><FontIcon name="calendar-days" /></span><span><b>{loading ? <Skel w={40} h={26} /> : open.length}</b><small>Sesi sedang dibuka</small></span></div>
        <div className="kpi"><span className="kpi__icon"><FontIcon name="circle-check" /></span><span><b>{loading ? <Skel w={56} h={26} /> : number.format(sum('valid') + sum('review') + sum('rejected') + sum('unavailable'))}</b><small>Total catatan absensi di sesi aktif</small>
          {!loading && <small>Sudah hadir: {number.format(sum('valid') + sum('review'))}</small>}</span></div>
        <div className="kpi"><span className="kpi__icon"><FontIcon name="triangle-exclamation" /></span><span><b>{loading ? <Skel w={40} h={26} /> : sum('review')}</b><small>Perlu dicek</small></span></div>
        {lo
          ? <div className="kpi"><span className="kpi__icon"><FontIcon name="location-dot" /></span><span><b style={{ fontSize: 16 }}>{user?.venue?.name}</b><small>Venue Anda</small></span></div>
          : <div className="kpi"><span className="kpi__icon"><FontIcon name="location-dot" /></span><span><b>{!venues ? <Skel w={30} h={26} /> : activeVenues}</b><small>Venue aktif</small></span></div>}
      </div>

      <div className={`dashboard-overview${lo || venueId ? ' dashboard-overview--single' : ''}`}>
      <section className="dashboard-sessions" aria-labelledby="dashboard-sessions-title">
      <h3 id="dashboard-sessions-title">Absensi per sesi</h3>
      <p className="muted small">Total catatan mencakup Valid, Perlu dicek, Ditolak, dan Berhalangan. Sudah hadir mencakup Valid dan Perlu dicek.</p>
      {sessionsError && <p className="alert alert--warn" role="status">Rekap sesi gagal diperbarui. Klik Muat ulang untuk mencoba lagi.</p>}
      {loading && !sessionsError && <div className="stats"><SkelCards n={3} h={170} /></div>}
      {!loading && !sessions.length && <p className="muted">Belum ada sesi{!lo && <> — <Link to="/admin/sesi">buat sesi</Link></>}.</p>}
      <div className="stats">
        {sessions.map((s) => {
          const checkedIn = s.valid + s.review;
          const totalRecords = checkedIn + s.rejected + s.unavailable;
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
              <div className="stat__big">{number.format(totalRecords)}<small> total catatan absensi</small></div>
              <div className="muted small">Sudah hadir: <b>{number.format(checkedIn)}</b> / {number.format(s.expected)} target ({pct}%)</div>
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
        <p className="muted small">{day === null ? 'Menentukan hari absensi…' : selectedTest ? `Ringkasan sesi test: ${sessionTitle(selectedTest)}. Tidak digabung dengan sesi resmi.` : selectedDay ? `Ringkasan ${checkInDayLabel(selectedDay)}.` : 'Gabungan semua sesi resmi.'} Setiap orang dihitung sekali per venue.</p>
        <div className="scan-display-controls">
          <details className="scan-column-picker">
            <summary className="btn btn--sm">Atur jenis peserta ({visibleGroups.length}/{venueGroups.length})</summary>
            <div className="scan-column-options">
              {venueGroups.map(([key, label]) => <label className="check" key={key}>
                <input type="checkbox" checked={!hiddenGroups.includes(key)} disabled={visibleGroups.length === 1 && !hiddenGroups.includes(key)}
                  onChange={(event) => setHiddenGroups((current) => event.target.checked ? current.filter((item) => item !== key) : [...current, key])} />
                <span>{label}</span>
              </label>)}
            </div>
          </details>
          <button type="button" className="btn btn--sm" onClick={() => setHiddenGroups([])}>Tampilkan semua</button>
        </div>
        {hiddenGroups.length > 0 && <p className="muted small">Total pada kartu mengikuti jenis peserta yang ditampilkan.</p>}
        {summaryError && <p className="alert alert--warn" role="status">Ringkasan venue gagal diperbarui.</p>}
        {!venueAttendance && !summaryError && <div className="stats"><SkelCards n={2} h={190} /></div>}
        {venueAttendance && !shownVenues.length && <p className="muted">Belum ada venue untuk ditampilkan.</p>}
        <div className="venue-attendance-grid">
          {shownVenues.map((venue) => <VenueAttendanceCard key={venue.id} venue={venue} day={selectedDay} testSession={selectedTest} onDetails={setDetails} visibleGroups={visibleGroups} />)}
        </div>
      </section>
      </div>
      <AttendanceDetailDialog details={details} onClose={() => setDetails(null)} />
    </div>
  );
}
