import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { getDeviceId } from '../lib/device.js';
import { fmtClock, fmtDate } from '../lib/time.js';
import Icon from '../components/Icon.jsx';
import BrandMark from '../components/BrandMark.jsx';

const STATUS = {
  valid: { label: 'Tercatat', icon: 'check', cls: 'ok' },
  review: { label: 'Menunggu verifikasi', icon: 'clock', cls: 'warn' },
  ditolak: { label: 'Ditolak panitia', icon: 'x', cls: 'err' },
};

export default function Riwayat() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    const deviceId = getDeviceId();
    if (!deviceId) { setRows([]); setError('Browser ini memblokir penyimpanan data, jadi riwayat tidak tersedia.'); return; }
    setLoading(true);
    setError(null);
    try { setRows(await api('/riwayat', { method: 'POST', body: { deviceId } })); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  // Kelompokkan per tanggal
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of rows || []) {
      const k = fmtDate(r.created_at);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.entries()];
  }, [rows]);

  const count = (st) => (rows || []).filter((r) => r.status === st).length;

  return (
    <div className="absen">
      <header className="hero hero--absen">
        <div className="hero__deco" aria-hidden="true" />
        <nav className="topbar">
          <Link to="/" className="topbar__back"><Icon name="left" size={18} /> Beranda</Link>
          <button className="topbar__link" onClick={load} disabled={loading} style={{ border: 0, font: 'inherit', cursor: 'pointer' }}>
            <Icon name="refresh" size={16} /> {loading ? 'Memuat…' : 'Muat ulang'}
          </button>
        </nav>
        <div className="hero__body hero__body--compact">
          <BrandMark size={48} className="hero__logo" />
          <h1>Riwayat Absensi</h1>
          <p className="hero__sub">Absensi yang pernah dikirim dari perangkat ini</p>
        </div>
      </header>

      <main className="sheet">
        <div className="card history">
          {rows && rows.length > 0 && (
            <div className="history__summary">
              <div><b>{rows.length}</b><small>Total</small></div>
              <div className="ok"><b>{count('valid')}</b><small>Tercatat</small></div>
              <div className="warn"><b>{count('review')}</b><small>Menunggu</small></div>
              <div className="err"><b>{count('ditolak')}</b><small>Ditolak</small></div>
            </div>
          )}

          {error && <div className="alert alert--err"><Icon name="alert" size={18} /><span>{error}</span></div>}
          {!rows && !error && <p className="muted" style={{ textAlign: 'center' }}>Memuat riwayat…</p>}

          {rows && rows.length === 0 && !error && (
            <div className="empty">
              <span className="empty__icon"><Icon name="list" size={30} /></span>
              <b>Belum ada riwayat</b>
              <p className="muted small">Belum ada absensi yang dikirim dari perangkat ini.</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <Link to="/absen/peserta" className="btn btn--sm"><Icon name="cap" size={16} />Absen Peserta</Link>
                <Link to="/absen/panitia" className="btn btn--sm"><Icon name="idcard" size={16} />Absen Panitia</Link>
              </div>
            </div>
          )}

          {groups.map(([day, list]) => (
            <section key={day} className="history__day">
              <h3>{day}</h3>
              <ul className="history__list">
                {list.map((r, i) => {
                  const st = STATUS[r.status] || STATUS.review;
                  return (
                    <li key={i} className="history__item">
                      <span className={`history__icon history__icon--${st.cls}`}><Icon name={st.icon} size={20} stroke={2.4} /></span>
                      <span className="history__body">
                        <span className="history__top">
                          <b>{r.session}</b>
                          <span className="tag tag--type">{r.session_type}</span>
                        </span>
                        <span className="history__meta">
                          {r.name} · <span className="cap">{r.role}</span>
                        </span>
                        <span className="history__meta">
                          <Icon name="pin" size={14} /> {r.venue || '-'} · {r.distance_m} m
                        </span>
                        <span className={`history__status history__status--${st.cls}`}>{st.label}</span>
                      </span>
                      <span className="history__time">{fmtClock(r.created_at).slice(0, 5)}<small>WIB</small></span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <p className="muted small history__note">
            <Icon name="info" size={15} /> Riwayat tersimpan per perangkat dan browser. Jika data browser dihapus,
            atau Anda memakai browser/HP lain, riwayat sebelumnya tidak akan tampil di sini, tetapi absensi Anda tetap tercatat di panitia.
          </p>
        </div>
      </main>
    </div>
  );
}
