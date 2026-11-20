import { lazy, useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { adminToken, adminUser, api } from '../api.js';
import Icon from '../components/Icon.jsx';
import FontIcon from '../components/FontIcon.jsx';
import BrandMark from '../components/BrandMark.jsx';
import { useEvents } from '../components/EventScope.jsx';
import DeferredSection from '../components/DeferredSection.jsx';
import VenueSchedule from '../components/VenueSchedule.jsx';
import { currentAndUpcomingBimtek } from '../lib/bimtekSchedule.js';
import { useNow, fmtClock, fmtDate } from '../lib/time.js';

const VervalDashboard = lazy(() => import('../components/VervalDashboard.jsx'));
const PublicDashboardSection = lazy(() => import('./PublicDashboard.jsx').then((module) => ({ default: module.PublicDashboardSection })));

const workflows = [
  ['Pilih program', 'Pilih BIMTEK Pelaporan atau BIMTEK PKS SPAB melalui tombol akses di atas.'],
  ['Masuk dengan akun Anda', 'Gunakan akun admin atau LO yang ditugaskan pada program tersebut.'],
  ['Kelola kegiatan', 'Pantau laporan dan fasilitator untuk Pelaporan, atau rekap PKS dan verifikator untuk PKS SPAB. Absensi mengikuti jadwal masing-masing program.'],
];

export default function Home() {
  const { hash } = useLocation();
  const [params] = useSearchParams();
  const [info, setInfo] = useState(null);
  const now = useNow();
  const scope = useEvents();
  const pks = scope.event.id === 5;
  const schedule = pks ? [{ stage: 5, dates: '23–28 November 2026' }] : currentAndUpcomingBimtek(now);
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
        <DeferredSection id="panduan-menu" title="Cara akses dashboard">
          <section className="panel" aria-labelledby="cara-akses">
            <h2 id="cara-akses" className="panel__title">Mulai menggunakan dashboard</h2>
            <p className="muted">Tersedia dua program dengan data, penugasan, dan jadwal absensi masing-masing.</p>
            <ol className="steps">
              {workflows.map(([label, description]) => <li key={label}><b>{label}</b><small>{description}</small></li>)}
            </ol>
          </section>
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
        <footer className="footer">Dashboard BIMTEK · Pelaporan & PKS SPAB{info?.organizer ? ` · ${info.organizer}` : ''}</footer>
      </main>
    </div>
  );
}
