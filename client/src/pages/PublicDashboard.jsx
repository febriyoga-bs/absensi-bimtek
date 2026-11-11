import { useEffect, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import BrandMark from '../components/BrandMark.jsx';
import FontIcon from '../components/FontIcon.jsx';
import ArrivalBreakdown from '../components/ArrivalBreakdown.jsx';
import ArrivalTotals from '../components/ArrivalTotals.jsx';
import { venueAttendanceGroups } from '../lib/venueAttendanceGroups.js';
import { ReportingView } from './admin/Reporting.jsx';
import './admin/Reporting.css';

const number = new Intl.NumberFormat('id-ID');
const sections = {
  pelaporan: {
    label: 'Pantau Pelaporan', icon: 'chart-line', description: 'Status Laporan 50% sekolah per venue.',
    periods: [['current', 'BIMTEK Tahap 3'], ['k3', 'BIMTEK Tahap 2']],
  },
  absensi: {
    label: 'Rekap Absensi', icon: 'clipboard-list', description: 'Absensi resmi peserta dan LO per venue.',
    columns: [['target', 'Target absensi'], ['checked_in', 'Sudah absen']],
  },
  kehadiran: {
    label: 'Rekap Kehadiran', icon: 'door-open', description: 'Kedatangan di venue berdasarkan impor Detail Peserta.',
    columns: [['invited', 'Undangan'], ['arrived', 'Sudah tiba'], ['queued', 'Sedang antre']],
  },
};

export default function PublicDashboard() {
  const [params, setParams] = useSearchParams();
  const { section: routeSection } = useParams();
  const requested = routeSection || params.get('bagian');
  const section = Object.hasOwn(sections, requested) ? requested : 'pelaporan';
  const { label, description, columns = [] } = sections[section];
  const [days, setDays] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const periods = section === 'absensi' ? days : sections[section].periods;
  const selected = params.get('periode');
  const period = periods?.some(([value]) => value === selected) ? selected : periods?.[0]?.[0];
  const path = `/dashboard/${section}${period ? `?period=${encodeURIComponent(period)}` : ''}`;
  const [result, setResult] = useState(null);
  const [reload, setReload] = useState(0);
  const current = result?.path === path ? result : null;

  useEffect(() => {
    api('/info').then((data) => setDays((data.check_in_days || []).map(({ date, label, shortDate }) =>
      [date, `${label} · ${shortDate}`]))).catch(() => {});
  }, []);

  useEffect(() => {
    if (routeSection !== section) return;
    let active = true;
    api(path).then((data) => {
      if (active) setResult({ path, ...(section === 'pelaporan' ? { report: data } : { rows: data }) });
    })
      .catch((error) => { if (active) setResult({ path, error: error.message }); });
    return () => { active = false; };
  }, [path, reload, routeSection, section]);

  if (routeSection !== section) {
    const search = selected ? `?${new URLSearchParams({ periode: selected })}` : '';
    return <Navigate to={`/dashboard/${section}${search}`} replace />;
  }

  const rows = current?.rows || [];

  return <div className="admin">
    <aside className="admin__nav" onKeyDown={(event) => {
      if (event.key === 'Escape' && menuOpen) {
        setMenuOpen(false);
        event.currentTarget.querySelector('.admin__menu-toggle')?.focus();
      }
    }}>
      <div className="admin__nav-head">
        <div className="admin__brand"><BrandMark size={38} />
          <span>Dashboard Publik<small>BIMTEK Revitalisasi SD</small></span>
        </div>
        <button className="admin__menu-toggle" type="button" aria-expanded={menuOpen}
          aria-controls="public-dashboard-menu" onClick={() => setMenuOpen(!menuOpen)}>
          <FontIcon name={menuOpen ? 'xmark' : 'bars'} /> {menuOpen ? 'Tutup' : 'Menu'}
        </button>
      </div>
      <nav id="public-dashboard-menu" className={`admin__menu${menuOpen ? ' is-open' : ''}`} aria-label="Menu dashboard publik">
        {Object.entries(sections).map(([key, item]) => <Link key={key} to={`/dashboard/${key}`}
          aria-current={section === key ? 'page' : undefined} className={section === key ? 'active' : undefined}
          onClick={() => setMenuOpen(false)}>
          <FontIcon name={item.icon} /> {item.label}
        </Link>)}
        <Link to="/" className="link"><FontIcon name="house" /> Beranda</Link>
      </nav>
    </aside>
    <main className={`admin__main${section === 'pelaporan' ? ' reporting-page' : ' attendance-dashboard'}`}>
      <div className="page-head">
        <div><h2 id="public-dashboard-title">{label}</h2><p className="muted">{description}</p></div>
        <div className="row public-dashboard__filters">
          {section === 'absensi' && !!periods?.length && <select value={period} aria-label="Periode" onChange={(event) =>
            setParams({ periode: event.target.value })}>
            {periods.map(([value, title]) => <option key={value} value={value}>{title}</option>)}
          </select>}
          <button className="btn btn--sm" type="button" onClick={() => { setResult(null); setReload((value) => value + 1); }}>
            <FontIcon name="rotate" /> Muat ulang
          </button>
        </div>
      </div>
      {section === 'pelaporan' && <div className="reporting-datasets" role="group" aria-label="Tahap Bimtek">
        {periods.map(([value, title]) => <button type="button" key={value} className={period === value ? 'on' : undefined}
          aria-pressed={period === value} onClick={() => setParams({ periode: value })}>{title}</button>)}
      </div>}
      {!current && <p className="muted" role="status">Memuat ringkasan…</p>}
      {current?.error && <p className="alert alert--err" role="alert">{current.error}</p>}
      {current?.rows && !rows.length && <p className="muted">Belum ada data pada bagian ini.</p>}
      {section === 'pelaporan' && current?.report && <ReportingView key={period} data={current.report}
        dataset={period} publicView refresh={() => setReload((value) => value + 1)} />}
      {section === 'absensi' && !!rows.length && <div className="stats">
        {rows.map(({ venue, counts, breakdown }) => {
          const pct = counts.target ? Math.round(counts.checked_in / counts.target * 100) : 0;
          return <article key={venue} className="stat">
            <div className="stat__head"><h4>{venue}</h4></div>
            <div className="stat__big">{number.format(counts.checked_in)}
              <small> / {number.format(counts.target)} sudah absen</small><strong>{pct}%</strong></div>
            <div className="bar"><span style={{ width: `${Math.min(pct, 100)}%` }} /></div>
            {breakdown && <table className="arrival-breakdown">
              <caption>Rincian absensi</caption>
              <thead><tr><th scope="col">Jenis peserta</th><th scope="col">Target</th><th scope="col">Sudah absen</th></tr></thead>
              <tbody>{venueAttendanceGroups.map(([key, label]) => <tr key={key}>
                <th scope="row">{label}</th>
                <td>{number.format(breakdown[key].target)}</td>
                <td>{number.format(breakdown[key].checked_in)}</td>
              </tr>)}</tbody>
            </table>}
          </article>;
        })}
      </div>}
      {section === 'kehadiran' && <ArrivalTotals venues={rows.filter(({ counts }) => counts)
        .map(({ counts, breakdown }) => ({ ...counts, breakdown }))} />}
      {section === 'kehadiran' && !!rows.length && <div className="venue-attendance-grid">
        {rows.map(({ venue, counts, breakdown }) => <article key={venue} className="venue-attendance">
          <div className="venue-attendance__head">
            <span className="arrival-venue-icon"><FontIcon name="location-dot" /></span>
            <h4>{venue}</h4>
          </div>
          {counts ? <dl className="venue-attendance__groups arrival-venue-metrics public-arrival-metrics">
            {columns.map(([key, title]) => <div key={key} className={`arrival-metric--${key}`}>
              <dt className="arrival-metric__label">{title}</dt>
              <dd className="arrival-metric__value"><b>{number.format(counts[key])}</b></dd>
            </div>)}
          </dl> : <p className="muted small">Belum ada data impor.</p>}
          <ArrivalBreakdown rows={breakdown} />
        </article>)}
      </div>}
    </main>
  </div>;
}
