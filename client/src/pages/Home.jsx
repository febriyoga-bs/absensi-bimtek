import { lazy, useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { adminToken, adminUser, api } from '../api.js';
import Icon from '../components/Icon.jsx';
import FontIcon from '../components/FontIcon.jsx';
import BrandMark from '../components/BrandMark.jsx';
import { menuForEvent } from '../lib/dashboardMenu.js';
import { useEvents } from '../components/EventScope.jsx';
import DeferredSection from '../components/DeferredSection.jsx';
import VenueSchedule from '../components/VenueSchedule.jsx';
import { currentAndUpcomingBimtek } from '../lib/bimtekSchedule.js';
import { useNow, fmtClock, fmtDate } from '../lib/time.js';
import { checkInDayLabel } from './admin/shared.js';

const VervalDashboard = lazy(() => import('../components/VervalDashboard.jsx'));
const PublicDashboardSection = lazy(() => import('./PublicDashboard.jsx').then((module) => ({ default: module.PublicDashboardSection })));

const workflows = [
  ['Pantau Pelaporan', 'Cek sekolah binaan, fasilitator, ruangan, dan status laporan. Gunakan filter venue dan LO untuk mengubah cakupan.'],
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
  const { hash } = useLocation();
  const [params] = useSearchParams();
  const [info, setInfo] = useState(null);
  const now = useNow();
  const scope = useEvents();
  const pks = scope.event.id === 5;
  const menu = menuForEvent(pks);
  const schedule = pks ? [{ stage: 5, dates: '23–28 November 2026' }] : currentAndUpcomingBimtek(now);
  const showStage3 = schedule.some((item) => item.stage === 3);
  const signedIn = !!adminToken.get();
  const reportingEvent = scope.events.find(event => event.id !== 5 && event.status === 'active')
    || [...scope.events].filter(event => event.id !== 5).sort((a, b) => b.id - a.id)[0];
  const pksEvent = scope.events.find(event => event.id === 5);
  function accessPath(kind, event) {
    const compatible = signedIn && scope.event.id === event.id && (kind === 'pks' || adminUser.get()?.scope !== 'pks');
    const path = compatible ? kind === 'pks' ? '/admin/pks' : '/admin/pelaporan' : '/admin/login';
    return `${path}?program=${kind}&event=${event.id}`;
  }

  useEffect(() => {
    api('/info').then(setInfo).catch(() => {});
  }, []);

  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    <div className="home">
      <header className="hero hero--home">
        <div className="hero__deco" aria-hidden="true" />
        <nav className="topbar" aria-label="Navigasi beranda">
          <span className="brand"><BrandMark size={40} /><span className="brand__text">Dashboard LO<small>Kemendikdasmen</small></span></span>
        </nav>
        <div className="hero__body">
          <div className="eyebrow">{info?.organizer || 'Pendampingan Bimtek'}</div>
          <h1>Dashboard BIMTEK <span>Pilih kegiatan Anda</span></h1>
          <p className="home__intro">Akses pendampingan, rekap, dan absensi sesuai kegiatan yang Anda tangani.</p>
          <div className="home-access" aria-label="Pilih akses kegiatan BIMTEK">
            {[
              { kind: 'pelaporan', event: reportingEvent, title: 'BIMTEK PELAPORAN', icon: 'chart-line', description: 'Pantau laporan sekolah, pendampingan fasilitator, dan absensi peserta.', detail: reportingEvent?.name || 'Bimtek Pelaporan' },
              { kind: 'pks', event: pksEvent, title: 'BIMTEK PKS SPAB', icon: 'clipboard-check', description: 'Pantau rekap PKS, penugasan verifikator, dan absensi Satdik Aman Bencana.', detail: '23–28 November 2026' },
            ].map(item => <section key={item.kind} className={`home-access__card home-access__card--${item.kind}`}>
              <span className="home-access__icon"><FontIcon name={item.icon} /></span>
              <h2>{item.title}</h2><p>{item.description}</p><small>{item.detail}</small>
              {item.event ? <a className="btn home-access__button" href={accessPath(item.kind, item.event)}>Masuk {item.kind === 'pks' ? 'PKS SPAB' : 'Pelaporan'}<Icon name="right" size={18} /></a> : <span className="home-access__unavailable">Kegiatan belum tersedia</span>}
            </section>)}
          </div>
          <div className="hero__meta">
            {schedule.map(({ stage, dates }) => <span key={stage} className="chip-inv"><Icon name="calendar" size={15} />{stage === 5 ? 'BIMTEK PKS SPAB' : `BIMTEK Tahap ${stage}`} · {dates}</span>)}
            {!!info?.venues?.length && <span className="chip-inv"><Icon name="pin" size={15} />{info.venues.length} venue · {info.event?.name}</span>}
            <span className="chip-inv"><Icon name="clock" size={15} />{fmtDate(now)} · {fmtClock(now)} WIB</span>
          </div>
        </div>
      </header>

      <main className="home__main">
        <DeferredSection id="panduan-menu" title="Panduan menu dashboard">
        <div className="landing-guide">
        <section className="panel" aria-labelledby="judul-panduan">
          <h2 id="judul-panduan" className="panel__title">Panduan menu dashboard</h2>
          <MenuGuide items={menu.filter((item) => item.lo)} />
          <details className="home-admin-guide">
            <summary>Menu tambahan Admin Utama</summary>
            <MenuGuide items={menu.filter((item) => !item.lo || item.adminLabel).map((item) => item.adminLabel
              ? { ...item, label: item.adminLabel, description: 'Lihat daftar peserta serta status kedatangan dan absensi per venue.' } : item)} />
          </details>
        </section>
        <section className="panel" aria-labelledby="langkah-lo">
          <h2 id="langkah-lo" className="panel__title">Mulai bekerja sebagai LO</h2>
          <p className="muted">Masuk dengan akun LO Anda. Peserta yang akan absen dapat menemui LO di venue kegiatan.</p>
          <ol className="steps">
            {(pks ? [['Pantau Rekap PKS', 'Cek sekolah binaan, verifikator, status dokumen PKS, dan catatan perbaikan.'], ...workflows.slice(1)] : workflows).map(([label, description]) => <li key={label}><b>{label}</b><small>{description}</small></li>)}
          </ol>
          {!!schedule.length && <div className="home-schedule">
            <b>Jadwal BIMTEK</b>
            {schedule.map(({ stage, dates }) => <span key={stage} className="tag tag--type">{stage === 5 ? 'PKS SPAB' : `TAHAP ${stage}`} · {dates}</span>)}
          </div>}
          {showStage3 && !!info?.check_in_days?.length && <div className="home-schedule">
            <b>Sesi absensi {info?.event?.name || 'BIMTEK'}</b>
            {info.check_in_days.map((day) => <span key={day.date} className="tag tag--type">{checkInDayLabel(day)}</span>)}
          </div>}
        </section>

        </div>
        </DeferredSection>

        {(pks ? [
          ['absensi', 'Rekap Absensi'], ['kehadiran', 'Rekap Kehadiran'],
        ] : [
          ['pelaporan', 'Pantau Pelaporan'], ['absensi', 'Rekap Absensi'], ['kehadiran', 'Rekap Kehadiran'],
        ]).map(([section, title]) => <DeferredSection key={section} id={`public-${section}`} title={title}>
          <PublicDashboardSection section={section} info={info} initialPeriod={params.get('periode')} />
        </DeferredSection>)}

        <DeferredSection id="lokasi-venue" title="Venue BIMTEK">
          <VenueSchedule info={info} />
        </DeferredSection>
        {!pks && <DeferredSection id="public-verval" title="Peta Revitalisasi">
          <VervalDashboard />
        </DeferredSection>}
        <footer className="footer">Dashboard LO · BIMTEK Revitalisasi SD{info?.organizer ? ` · ${info.organizer}` : ''}</footer>
      </main>
    </div>
  );
}
