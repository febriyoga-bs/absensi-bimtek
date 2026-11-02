import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, adminUrl } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { fmtDT } from './shared.js';

export default function Dashboard() {
  const [sessions, setSessions] = useState([]);
  const [venues, setVenues] = useState(null);

  useEffect(() => {
    const load = () => api('/admin/sessions', { admin: true }).then(setSessions);
    load();
    api('/admin/venues', { admin: true }).then(setVenues);
    const t = setInterval(load, 15000); // auto-refresh
    return () => clearInterval(t);
  }, []);

  const open = sessions.filter((s) => s.is_open);
  const sum = (k) => open.reduce((a, s) => a + s[k], 0);
  const activeVenues = venues?.filter((v) => v.active).length ?? 0;

  return (
    <>
      <div className="page-head">
        <div><h2>Rekap Kehadiran</h2><p className="muted">Diperbarui otomatis tiap 15 detik.</p></div>
      </div>
      {venues && activeVenues === 0 && (
        <div className="alert alert--warn" style={{ marginBottom: 16 }}><Icon name="alert" size={18} />
          <span>Belum ada venue aktif — absensi tidak bisa dilakukan. <Link to="/admin/venue">Tambah venue</Link></span>
        </div>
      )}

      <div className="kpis">
        <div className="kpi"><span className="kpi__icon"><Icon name="calendar" /></span><span><b>{open.length}</b><small>Sesi sedang dibuka</small></span></div>
        <div className="kpi"><span className="kpi__icon"><Icon name="check" /></span><span><b>{sum('valid') + sum('review')}</b><small>Hadir di sesi aktif</small></span></div>
        <div className="kpi"><span className="kpi__icon"><Icon name="alert" /></span><span><b>{sum('review')}</b><small>Perlu dicek</small></span></div>
        <div className="kpi"><span className="kpi__icon"><Icon name="pin" /></span><span><b>{activeVenues}</b><small>Venue aktif</small></span></div>
      </div>

      {!sessions.length && <p className="muted">Belum ada sesi. <Link to="/admin/sesi">Buat sesi</Link>.</p>}
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
                <span title="Percobaan diblokir otomatis (di luar radius, akurasi buruk, kode venue salah)">⛔ Diblokir {s.blocked}</span>
              </div>
              {s.by_venue.length > 0 && (
                <div className="chips">
                  {s.by_venue.map((v) => <span key={v.name} className="tag tag--venue">{v.name}: {v.n}</span>)}
                </div>
              )}
              <div className="row">
                <Link className="btn btn--sm" to={`/admin/absensi?sesi=${s.id}`}><Icon name="list" size={15} />Verifikasi</Link>
                <a className="btn btn--sm" href={adminUrl(`/export?session_id=${s.id}`)}><Icon name="download" size={15} />CSV</a>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
