import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api, adminUrl } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { useVisiblePolling } from '../../lib/poll.js';
import { fmtDT } from './shared.js';

export default function Dashboard() {
  const { user, lo } = useOutletContext() || {};
  const [sessions, setSessions] = useState([]);
  const [venues, setVenues] = useState(null);
  const [venueId, setVenueId] = useState(''); // filter venue (admin utama)

  useEffect(() => { api('/admin/venues', { admin: true }).then(setVenues); }, []);

  const qs = !lo && venueId ? `?venue_id=${venueId}` : '';
  // Diperbarui tiap 30 detik, hanya saat tab ini sedang dilihat
  useVisiblePolling(() => api(`/admin/sessions${qs}`, { admin: true }).then(setSessions).catch(() => {}), 30_000, [qs]);

  const open = sessions.filter((s) => s.is_open);
  const sum = (k) => open.reduce((a, s) => a + s[k], 0);
  const activeVenues = venues?.filter((v) => v.active).length ?? 0;
  const venueQs = (sid) => `/export?session_id=${sid}${!lo && venueId ? `&venue_id=${venueId}` : ''}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Rekap Kehadiran{lo && user?.venue ? ` — ${user.venue.name}` : ''}</h2>
          <p className="muted">Diperbarui otomatis tiap 30 detik selama halaman ini terbuka.</p>
        </div>
        {!lo && venues?.length > 1 && (
          <select value={venueId} onChange={(e) => setVenueId(e.target.value)} style={{ width: 'auto', minWidth: 220 }}>
            <option value="">Semua venue</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
      </div>
      {!lo && venues && activeVenues === 0 && (
        <div className="alert alert--warn" style={{ marginBottom: 16 }}><Icon name="alert" size={18} />
          <span>Belum ada venue aktif — absensi tidak bisa dilakukan. <Link to="/admin/venue">Tambah venue</Link></span>
        </div>
      )}

      <div className="kpis">
        <div className="kpi"><span className="kpi__icon"><Icon name="calendar" /></span><span><b>{open.length}</b><small>Sesi sedang dibuka</small></span></div>
        <div className="kpi"><span className="kpi__icon"><Icon name="check" /></span><span><b>{sum('valid') + sum('review')}</b><small>Hadir di sesi aktif</small></span></div>
        <div className="kpi"><span className="kpi__icon"><Icon name="alert" /></span><span><b>{sum('review')}</b><small>Perlu dicek</small></span></div>
        {lo
          ? <div className="kpi"><span className="kpi__icon"><Icon name="pin" /></span><span><b style={{ fontSize: 16 }}>{user?.venue?.name}</b><small>Venue Anda</small></span></div>
          : <div className="kpi"><span className="kpi__icon"><Icon name="pin" /></span><span><b>{activeVenues}</b><small>Venue aktif</small></span></div>}
      </div>

      {!sessions.length && <p className="muted">Belum ada sesi{!lo && <> — <Link to="/admin/sesi">buat sesi</Link></>}.</p>}
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
                <span title="Percobaan diblokir otomatis (di luar area venue, kode venue salah, dll.)">⛔ Diblokir {s.blocked}</span>
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
