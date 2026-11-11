import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminToken, api } from '../api.js';
import Icon from '../components/Icon.jsx';
import FontIcon from '../components/FontIcon.jsx';
import BrandMark from '../components/BrandMark.jsx';
import { dashboardMenu } from '../lib/dashboardMenu.js';
import { useNow, fmtClock, fmtDate } from '../lib/time.js';
import { checkInDayLabel } from './admin/shared.js';

const workflows = [
  ['Daftar Pendampingan', 'Cek sekolah dan fasilitator binaan serta ruangan penugasan.'],
  ['Absenkan Peserta', 'Pilih peserta yang Anda tangani, ambil foto, isi catatan, lalu kirim.'],
  ['Absen Saya', 'Kirim absensi Anda dengan foto dan lokasi saat sesi resmi dibuka.'],
];

function MenuGuide({ items }) {
  return <ul className="home-menu">
    {items.map(({ to, icon, label, description }) => <li key={to}>
      <span className="home-menu__icon"><FontIcon name={icon} /></span>
      <div><b>{label}</b><small>{description}</small></div>
    </li>)}
  </ul>;
}

export default function Home() {
  const [info, setInfo] = useState(null);
  const now = useNow();
  const signedIn = !!adminToken.get();
  const dashboardPath = signedIn ? '/admin' : '/admin/login';
  const dashboardLabel = signedIn ? 'Buka Dashboard' : 'Masuk Dashboard';

  useEffect(() => {
    api('/info').then(setInfo).catch(() => {});
  }, []);

  return (
    <div className="home">
      <header className="hero hero--home">
        <div className="hero__deco" aria-hidden="true" />
        <nav className="topbar" aria-label="Navigasi beranda">
          <span className="brand"><BrandMark size={40} /><span className="brand__text">Dashboard LO<small>Kemendikdasmen</small></span></span>
          <a href="#panduan-menu" className="topbar__link">Panduan menu</a>
          <Link to="/dashboard/pelaporan" className="topbar__link">Dashboard Publik</Link>
        </nav>
        <div className="hero__body">
          <div className="eyebrow">{info?.organizer || 'Pendampingan Bimtek'}</div>
          <h1>Dashboard LO <span>BIMTEK REVITALISASI SD</span></h1>
          <p className="home__intro">Kelola pendampingan sekolah, pantau Laporan 50%, dan catat absensi peserta di venue penugasan.</p>
          <Link to={dashboardPath} className="btn btn--lg home__cta">{dashboardLabel}<Icon name="right" size={19} /></Link>
          <div className="hero__meta">
            {info?.event_dates && <span className="chip-inv"><Icon name="calendar" size={15} />{info.event_dates}</span>}
            {!!info?.venues?.length && <span className="chip-inv"><Icon name="pin" size={15} />{info.venues.length} venue aktif</span>}
            <span className="chip-inv"><Icon name="clock" size={15} />{fmtDate(now)} · {fmtClock(now)} WIB</span>
          </div>
        </div>
      </header>

      <main className="home__main">
        <section className="panel" aria-labelledby="langkah-lo">
          <h2 id="langkah-lo" className="panel__title">Mulai bekerja sebagai LO</h2>
          <p className="muted">Masuk dengan akun LO Anda. Peserta yang akan absen dapat menemui LO di venue kegiatan.</p>
          <ol className="steps">
            {workflows.map(([label, description]) => <li key={label}><b>{label}</b><small>{description}</small></li>)}
          </ol>
          {!!info?.check_in_days?.length && <div className="home-schedule">
            <b>Jadwal BIMTEK TAHAP 3</b>
            {info.check_in_days.map((day) => <span key={day.date} className="tag tag--type">{checkInDayLabel(day)}</span>)}
          </div>}
        </section>

        <section className="panel" id="panduan-menu" aria-labelledby="judul-panduan">
          <h2 id="judul-panduan" className="panel__title">Panduan menu dashboard</h2>
          <MenuGuide items={dashboardMenu.filter((item) => item.lo)} />
          <details className="home-admin-guide">
            <summary>Menu tambahan Admin Utama</summary>
            <MenuGuide items={dashboardMenu.filter((item) => !item.lo || item.adminLabel).map((item) => item.adminLabel
              ? { ...item, label: item.adminLabel, description: 'Lihat daftar peserta serta status kedatangan dan absensi per venue.' } : item)} />
          </details>
        </section>

        {!!info?.venues?.length && <section className="panel" aria-labelledby="lokasi-venue">
          <h2 id="lokasi-venue" className="panel__title">Venue kegiatan</h2>
          <div className="venues">
            {info.venues.map((venue) => <div key={venue.name} className="venue-card">
              <span className="venue-card__icon"><Icon name="building" /></span>
              <span><b>{venue.name}</b>{venue.address && <small>{venue.address}</small>}</span>
            </div>)}
          </div>
        </section>}
        <footer className="footer">Dashboard LO · BIMTEK Revitalisasi SD{info?.organizer ? ` · ${info.organizer}` : ''}</footer>
      </main>
    </div>
  );
}
