import FilterField from '../components/FilterField.jsx';
import { useEffect, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import FontIcon from '../components/FontIcon.jsx';
import ArrivalBreakdown from '../components/ArrivalBreakdown.jsx';
import ArrivalTotals from '../components/ArrivalTotals.jsx';
import { venueAttendanceGroups } from '../lib/venueAttendanceGroups.js';
import { fmtFull } from '../lib/time.js';
import { ReportingView } from './admin/Reporting.jsx';
import './admin/Reporting.css';
import PublicAttendanceNames from '../components/PublicAttendanceNames.jsx';

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

export function PublicDashboardSection({ section, info, initialPeriod }) {
  const { label, description, columns = [] } = sections[section];
  const [days, setDays] = useState([]);

  const periods = section === 'absensi' ? days : sections[section].periods;
  const [selected, setSelected] = useState(initialPeriod);
  const period = periods?.some(([value]) => value === selected) ? selected : periods?.[0]?.[0];
  const path = `/dashboard/${section}${period ? `?period=${encodeURIComponent(period)}` : ''}`;
  const [result, setResult] = useState(null);
  const [reload, setReload] = useState(0);
  const [attendanceSelection, setAttendanceSelection] = useState(null);
  const current = result?.path === path ? result : null;

  useEffect(() => {
    setDays((info?.check_in_days || []).map(({ date, label, shortDate }) => [date, `${label} · ${shortDate}`]));
  }, [info]);

  useEffect(() => {
    let active = true;
    api(path).then((data) => {
      if (active) setResult({ path, ...(section === 'pelaporan' ? { report: data } : data) });
    }).catch((error) => { if (active) setResult({ path, error: error.message }); });
    return () => { active = false; };
  }, [path, reload, section]);
  const rows = current?.rows || [];
  const sourceStamp = section === 'pelaporan' ? current?.report?.stamp : current?.updated_at;
  const updateLabel = section === 'pelaporan' ? 'Monitoring terakhir' : section === 'kehadiran' ? 'Impor terakhir' : 'Absensi terakhir';
  const updateTime = sourceStamp
    ? section === 'pelaporan' && period === 'k3' ? sourceStamp : fmtFull(sourceStamp)
    : section === 'absensi' ? 'Belum ada absensi' : 'Belum ada data';

  return <section aria-labelledby={`public-${section}-title`}
    className={`landing-dashboard panel ${section === 'pelaporan' ? 'reporting-page' : 'attendance-dashboard'}`}>
      <div className="page-head">
        <div><h2 id={`public-${section}-title`}>{label}</h2><p className="muted">{description}</p></div>
        <div className="public-dashboard__tools">
        {current && !current.error && <p className="muted small public-dashboard__updated" role="status">
          {updateLabel} · {updateTime}
        </p>}
        <div className="row public-dashboard__filters">
          {section === 'absensi' && !!periods?.length && <FilterField label="Periode"><select value={period} aria-label="Periode" onChange={(event) =>
            setSelected(event.target.value)}>
            {periods.map(([value, title]) => <option key={value} value={value}>{title}</option>)}
          </select></FilterField>}
          <button className="btn btn--sm" type="button" onClick={() => { setResult(null); setReload((value) => value + 1); }}>
            <FontIcon name="rotate" /> Muat ulang
          </button>
        </div>
        </div>
      </div>
      {section === 'pelaporan' && <div className="reporting-datasets" role="group" aria-label="Tahap Bimtek">
        {periods.map(([value, title]) => <button type="button" key={value} className={period === value ? 'on' : undefined}
          aria-pressed={period === value} onClick={() => setSelected(value)}>{title}</button>)}
      </div>}
      {!current && <p className="muted" role="status">Memuat ringkasan…</p>}
      {current?.error && <p className="alert alert--err" role="alert">{current.error}</p>}
      {current?.rows && !rows.length && <p className="muted">Belum ada data pada bagian ini.</p>}
      {section === 'pelaporan' && current?.report && <ReportingView key={period} data={current.report}
        dataset={period} publicView refresh={() => setReload((value) => value + 1)} />}
      {section === 'absensi' && !!rows.length && <div className="stats">
        {rows.map(({ id, venue, counts, breakdown }) => {
          const pct = counts.target ? Math.round(counts.checked_in / counts.target * 100) : 0;
          return <article key={venue} className="stat">
            <div className="stat__head"><h4>{venue}</h4></div>
            <div className="stat__big">{number.format(counts.checked_in)}
              <small> / {number.format(counts.target)} sudah absen</small><strong>{pct}%</strong></div>
            <div className="bar"><span style={{ width: `${Math.min(pct, 100)}%` }} /></div>
            {breakdown && <table className="arrival-breakdown">
              <caption>Rincian absensi</caption>
              <thead><tr><th scope="col">Jenis peserta</th><th scope="col">Target</th><th scope="col">Sudah absen</th></tr></thead>
              <tbody>{venueAttendanceGroups.filter(([key]) => ['bendahara','pengawas','fasil','lo'].includes(key)).map(([key, label]) => <tr key={key}>
                <th scope="row">{label}</th>
                <td><button type="button" className="link-btn" aria-label={`Target ${label} di ${venue}`}
                  onClick={() => setAttendanceSelection({ id, venue, group: key, label, period, scope: 'all' })}>{number.format(breakdown[key].target)}</button></td>
                <td><button type="button" className="link-btn" aria-label={`${label} sudah absen di ${venue}`}
                  onClick={() => setAttendanceSelection({ id, venue, group: key, label, period, scope: 'checked_in' })}>{number.format(breakdown[key].checked_in)}</button></td>
              </tr>)}</tbody>
            </table>}
          </article>;
        })}
      </div>}
      {attendanceSelection && <PublicAttendanceNames key={JSON.stringify(attendanceSelection)} selection={attendanceSelection} onClose={() => setAttendanceSelection(null)} />}
      {section === 'kehadiran' && <ArrivalTotals compact venues={rows.filter(({ counts }) => counts)
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
          <details className="public-arrival-breakdown"><summary>Rincian jenis peserta</summary><ArrivalBreakdown rows={breakdown} /></details>
        </article>)}
      </div>}
  </section>;
}

export default function PublicDashboard() {
  const { section } = useParams();
  const [params] = useSearchParams();
  const requested = section || params.get('bagian');
  const target = Object.hasOwn(sections, requested) ? requested : 'pelaporan';
  const search = params.get('periode') ? `?${new URLSearchParams({ periode: params.get('periode') })}` : '';
  return <Navigate to={`/${search}#public-${target}`} replace />;
}
