import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import BrandMark from '../components/BrandMark.jsx';
import { useVisiblePolling } from '../lib/poll.js';
import { useNow, fmtClock, fmtDate, fmtHM, fmtRemaining, dayLabel } from '../lib/time.js';
import { Skel, SkelCards } from '../components/Skeleton.jsx';

const ROLES = [
  { key: 'peserta', title: 'Absen Peserta', desc: 'Kepala sekolah, guru, dan peserta BIMTEK', icon: 'cap' },
  { key: 'panitia', title: 'Absen Panitia', desc: 'Panitia, narasumber, dan fasilitator', icon: 'idcard' },
];

function SessionStatus({ s, now, loading }) {
  if (loading) return <Skel w={210} h={26} r={99} />;
  if (s?.open) {
    return (
      <span className="pill pill--live">
        <span className="live-dot" />
        <span>Dibuka · {s.open.name} · tutup {fmtHM(s.open.ends_at)}
          <small> ({fmtRemaining(new Date(s.open.ends_at) - now)} lagi)</small></span>
      </span>
    );
  }
  if (s?.next) {
    return (
      <span className="pill">
        <Icon name="clock" size={14} /> Berikutnya: {s.next.name} · {dayLabel(s.next.starts_at)} {fmtHM(s.next.starts_at)}
      </span>
    );
  }
  return <span className="pill pill--muted">Belum ada jadwal sesi</span>;
}

export default function Home() {
  const [info, setInfo] = useState(null);
  const now = useNow();

  // status sesi diperbarui tiap 60 detik, hanya saat halaman sedang dilihat
  useVisiblePolling(() => api('/info').then(setInfo).catch(() => {}), 60_000);

  return (
    <div className="home">
      <header className="hero hero--home">
        <div className="hero__deco" aria-hidden="true" />
        <nav className="topbar">
          <span className="brand">
            <BrandMark size={40} />
            <span className="brand__text">Absensi BIMTEK<small>Kemendikdasmen</small></span>
          </span>
          <span className="topbar__actions">
            <Link to="/riwayat" className="topbar__link"><Icon name="clock" size={16} />Riwayat</Link>
            <Link to="/admin" className="topbar__link topbar__link--admin">Admin</Link>
          </span>
        </nav>

        <div className="hero__body">
          {info?.organizer && <div className="eyebrow">{info.organizer}</div>}
          <h1>{info?.event_name || 'BIMTEK Revitalisasi SD'}</h1>
          <div className="hero__meta">
            {info?.event_dates && <span className="chip-inv"><Icon name="calendar" size={15} />{info.event_dates}</span>}
            {info?.venues?.length > 0 && (
              <span className="chip-inv"><Icon name="pin" size={15} />{info.venues.length} lokasi venue</span>
            )}
          </div>
          <div className="clock">
            <div className="clock__time">{fmtClock(now)} <small>WIB</small></div>
            <div className="clock__date">{fmtDate(now)}</div>
          </div>
        </div>
      </header>

      <main className="home__main">
        <section className="roles">
          {ROLES.map((r) => (
            <Link key={r.key} to={`/absen/${r.key}`} className={`role role--${r.key}`}>
              <span className="role__icon"><Icon name={r.icon} size={30} /></span>
              <span className="role__text">
                <b>{r.title}</b>
                <small>{r.desc}</small>
                <SessionStatus s={info?.sessions?.[r.key]} now={now} loading={!info} />
              </span>
              <span className="role__go"><Icon name="right" size={22} /></span>
            </Link>
          ))}
        </section>

        <Link to="/riwayat" className="history-link">
          <span className="history-link__icon"><Icon name="clock" size={22} /></span>
          <span><b>Cek riwayat absensi di perangkat ini</b><small>Lihat absen yang sudah dikirim dan status verifikasinya</small></span>
          <Icon name="right" size={20} />
        </Link>

        <section className="panel">
          <h2 className="panel__title">Cara absen</h2>
          <ol className="steps">
            <li>
              <span className="steps__icon"><Icon name="key" /></span>
              <b>Masukkan NPSN / kode</b>
              <small>Peserta: NPSN sekolah lalu pilih jabatan. Panitia: kode panitia.</small>
            </li>
            <li>
              <span className="steps__icon"><Icon name="camera" /></span>
              <b>Foto & lokasi</b>
              <small>Foto wajah langsung dari kamera, GPS dicek otomatis.</small>
            </li>
            <li>
              <span className="steps__icon"><Icon name="check" /></span>
              <b>Selesai</b>
              <small>Bukti absen tampil dan tercatat di panitia.</small>
            </li>
          </ol>
          {info?.require_venue_code && (
            <div className="note"><Icon name="monitor" size={18} />
              Siapkan juga <b>kode venue 6 digit</b> yang tampil di layar panitia di lokasi Anda.
            </div>
          )}
        </section>

        {!info && (
          <section className="panel"><Skel w={140} h={18} /><div className="venues" style={{ marginTop: 14 }}><SkelCards n={2} h={90} /></div></section>
        )}
        {info?.venues?.length > 0 && (
          <section className="panel">
            <h2 className="panel__title">Lokasi venue</h2>
            <div className="venues">
              {info.venues.map((v) => (
                <div key={v.name} className="venue-card">
                  <span className="venue-card__icon"><Icon name="building" /></span>
                  <span>
                    <b>{v.name}</b>
                    {v.address && <small>{v.address}</small>}
                    <span className="tag">Radius {v.radius_m} m</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="trust">
          <div><Icon name="shield" size={22} /><span><b>Anti Fake GPS</b><small>Lokasi palsu terdeteksi otomatis</small></span></div>
          <div><Icon name="camera" size={22} /><span><b>Kamera realtime</b><small>Tidak bisa unggah dari galeri</small></span></div>
          <div><Icon name="crosshair" size={22} /><span><b>Geotagging</b><small>Hanya di dalam area venue</small></span></div>
        </section>

        <footer className="footer">
          {info?.event_name || 'BIMTEK Revitalisasi SD'}{info?.organizer ? ` · ${info.organizer}` : ''}
        </footer>
      </main>
    </div>
  );
}
