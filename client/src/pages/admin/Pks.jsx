import LoRepresentation from '../../components/LoRepresentation.jsx';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useOutletContext } from 'react-router-dom';
import { api } from '../../api.js';
import { selectedEvent } from '../../event.js';
import { personName } from '../../lib/personName.js';
import { groupPksVerifiers } from '../../lib/pksVerifiers.js';
import FilterField from '../../components/FilterField.jsx';
import PksRanking, { rankVerifiers } from './PksRanking.jsx';
import WhatsAppLink from '../../components/WhatsAppLink.jsx';
import ArrivalImport from './ArrivalImport.jsx';
import { pksArrivalBadge } from './shared.js';
import './Pks.css';

const views = { schools: 'Sekolah', verifiers: 'Verifikator', lo: 'LO', ranking: 'Peringkat LO', verifierRanking: 'Peringkat Verifikator' };
const number = new Intl.NumberFormat('id-ID');
const arrivalRoleOrder = { 'Kepala Sekolah': 0, Bendahara: 1 };
const arrivalStatuses = ['sudah_tiba', 'sedang_antre', 'belum_tiba', 'belum_tercatat'];
const arrivalOptions = arrivalStatuses.map(code => pksArrivalBadge(code)[0]);
function matchesArrival(school, label) {
  if (school.arrival_statuses?.length) {
    return school.arrival_statuses.some(status => pksArrivalBadge(status)[0] === label);
  }
  return school.arrival_attendees?.length
    ? school.arrival_attendees.some(attendee => pksArrivalBadge(attendee.status)[0] === label)
    : pksArrivalBadge(school.arrival_status)[0] === label;
}
function ArrivalChip({ status }) {
  const [label, style] = pksArrivalBadge(status);
  return <span className={`tag ${style}`}>{label.toLocaleUpperCase('id')}</span>;
}

const participantQuota = 2;
function participantStatusIndexes(school) {
  const attendees = (school.arrival_attendees || []).map(({ role, status }) => ({
    roleOrder: arrivalRoleOrder[role] ?? 2,
    statusIndex: arrivalOptions.indexOf(pksArrivalBadge(status)[0]),
  }));
  attendees.sort((a, b) => a.roleOrder - b.roleOrder || a.statusIndex - b.statusIndex);
  return Array.from({ length: participantQuota }, (_, index) =>
    attendees[index]?.statusIndex ?? arrivalOptions.length - 1);
}

function summarizeAttendance(schools) {
  const participants = arrivalOptions.map(() => 0);
  for (const school of schools) {
    for (const statusIndex of participantStatusIndexes(school)) participants[statusIndex]++;
  }
  return {
    schools: arrivalOptions.map(label => schools.filter(school => matchesArrival(school, label)).length),
    participants,
    participantTotal: schools.length * participantQuota,
  };
}

function ArrivalTotalsRow({ title, totalLabel, total, counts, onSelect, activeLabel }) {
  return <div className="pks-arrival-row">
    <h3>{title}</h3>
    <div className="pks-arrival-totals">
      <button type="button" onClick={() => onSelect('')}>
        <span className="tag">{totalLabel}</span>
        <strong>{number.format(total)}</strong>
      </button>
      {arrivalStatuses.map((code, index) => (
        <button key={code} type="button" onClick={() => onSelect(arrivalOptions[index])}
          aria-pressed={activeLabel === arrivalOptions[index]}
          aria-label={`${title}, ${arrivalOptions[index]}, ${number.format(counts[index])}`}>
          <ArrivalChip status={code} />
          <strong>{number.format(counts[index])}</strong>
        </button>
      ))}
    </div>
  </div>;
}

function PksAttendanceSummary({ schools, onSelect, arrivalFilter, arrivalByParticipant }) {
  const totals = summarizeAttendance(schools);
  const helpRef = useRef(null);
  return <section className="pks-attendance-summary" aria-labelledby="pks-arrival-heading">
    <div className="pks-arrival-heading">
      <h2 id="pks-arrival-heading">Rekap Kehadiran</h2>
      <button type="button" className="pks-arrival-help" aria-label="Cara menghitung rekap kehadiran"
        aria-haspopup="dialog" onClick={() => helpRef.current.showModal()}>
        <span aria-hidden="true">?</span>
      </button>
    </div>
    <dialog ref={helpRef} className="assignment-dialog pks-arrival-help-dialog" aria-labelledby="pks-arrival-help-title">
      <header><h3 id="pks-arrival-help-title">Cara menghitung kehadiran sekolah</h3></header>
      <p><strong>Total Sekolah</strong> menghitung setiap sekolah satu kali. Pada kartu status, satu sekolah bisa muncul di beberapa kategori jika status pesertanya berbeda.</p>
      <p>Misalnya, jika kepala sekolah sudah tiba dan bendahara masih antre, sekolah tersebut masuk ke kartu <strong>Sudah Tiba</strong> dan <strong>Sedang Antre</strong>. Karena itu, penjumlahan kartu status bisa melebihi Total Sekolah.</p>
      <form method="dialog"><button type="submit" className="btn btn--sm">Tutup</button></form>
    </dialog>
    <ArrivalTotalsRow title="Jumlah sekolah" totalLabel="Total sekolah" total={schools.length} counts={totals.schools}
      onSelect={onSelect} activeLabel={arrivalByParticipant ? '' : arrivalFilter} />
    <ArrivalTotalsRow title="Jumlah peserta sekolah" totalLabel="Total peserta" total={totals.participantTotal} counts={totals.participants}
      onSelect={label => onSelect(label, true)} activeLabel={arrivalByParticipant ? arrivalFilter : ''} />
  </section>;
}

const progressGroups = [
  { label: 'Biodata', className: 'pks-progress-group--bio', metrics: ['belum_login', 'bio_belum', 'bio_proses', 'bio_tunggu', 'bio_ok'] },
  { label: 'RAB & BA', className: 'pks-progress-group--rab', metrics: ['sepakat_rab', 'ba'] },
  { label: 'PKS', className: 'pks-progress-group--pks', metrics: ['pks', 'pks_ppk', 'meterai'] },
];
const progressMetricLabels = [
  ['total', 'Total sekolah'], ['belum_login', '1. Belum login'], ['bio_belum', '2. Belum mengisi biodata'],
  ['bio_proses', '3. Proses mengisi biodata'], ['bio_tunggu', '4. Menunggu verifikasi biodata'],
  ['bio_ok', '5. Sudah verifikasi biodata'], ['sepakat_rab', '6. Sepakat RAB'], ['ba', '7. TTD BA'],
  ['pks', '8. TTE Kepsek PKS'], ['pks_ppk', '9. TTE PPK PKS'], ['meterai', '10. E-Meterai'], ['tidak_terdata', 'Tidak terdata'],
];
function percent(value, total) { return `${total ? Math.round((value / total) * 100) : 0}%`; }

function Contact({ phone, email, name }) {
  return <>{phone && <small className="pks-contact-phone"><span>{phone}</span><WhatsAppLink phone={phone} name={name} /></small>}{email && <small className="pks-contact-email"><a href={`mailto:${email}`}>{email}</a></small>}</>;
}

export default function Pks({ publicView = false }) {
  const { user } = useOutletContext() || {};
  const loView = !publicView && user?.role === 'lo';
  const [globalRoster, setGlobalRoster] = useState(null);
  const [globalRosterError, setGlobalRosterError] = useState('');
  function request(suffix = '', params = new URLSearchParams()) {
    if (publicView) params.set('event', '5');
    const query = params.size ? '?' + params : '';
    return api((publicView ? '/pks' : '/admin/pks') + suffix + query, { admin: !publicView });
  }

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sourceData, setSourceData] = useState(null);
  const [schoolStatuses, setSchoolStatuses] = useState(null);
  const [schoolStatusesError, setSchoolStatusesError] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [sourceLoading, setSourceLoading] = useState(true);
  const [sourceRanking, setSourceRanking] = useState(null);
  const [sourceRankingError, setSourceRankingError] = useState('');
  const [sourceRankingLoading, setSourceRankingLoading] = useState(false);
  const [detailContext, setDetailContext] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailQuery, setDetailQuery] = useState('');
  const [query, setQuery] = useState('');
  const [selectedVenue, setVenue] = useState('');
  const [selectedOwner, setOwner] = useState('');
  const ownLo = loView ? data?.lo?.[0] : null;
  const venue = loView ? ownLo?.venue || '' : selectedVenue;
  const owner = loView ? ownLo?.name || '' : selectedOwner;
  const [verifier, setVerifier] = useState('');
  const [view, setView] = useState('schools');
  const [status, setStatus] = useState('');
  const [arrivalFilter, setArrivalFilter] = useState('');
  const [arrivalByParticipant, setArrivalByParticipant] = useState(false);
  const resultsRef = useRef(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  async function load() {
    setError('');
    try {
      setData(await request());
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }
  async function loadGlobalRoster() {
    setGlobalRosterError('');
    try {
      setGlobalRoster(await api('/pks?event=5'));
    } catch (e) {
      setGlobalRosterError(e.message);
    }
  }
  async function loadSource() {
    loadSchoolStatuses();
    setSourceLoading(true);
    setSourceError('');
    try { setSourceData(await request('/progress')); }
    catch (e) { setSourceError(e.message || 'Data dari dashboard sumber belum dapat dimuat.'); }
    finally { setSourceLoading(false); }
  }
  async function loadSchoolStatuses() {
    setSchoolStatusesError(false);
    try {
      setSchoolStatuses(await (loView ? api('/pks/progress/statuses?event=5') : request('/progress/statuses')));
    } catch {
      setSchoolStatusesError(true);
    }
  }
  async function loadSourceRanking() {
    if (sourceRankingLoading) return;
    setSourceRankingLoading(true);
    setSourceRankingError('');
    try { setSourceRanking(await request('/progress/lo-ranking')); }
    catch (e) { setSourceRankingError(e.message || 'Peringkat LO dari Revit belum dapat dimuat.'); }
    finally { setSourceRankingLoading(false); }
  }
  async function loadSchoolDetail(metric, hotel = '', page = 1, query = '') {
    setDetailLoading(true);
    setDetailError('');
    try {
      const params = new URLSearchParams({ metric, page: String(page) });
      if (hotel) params.set('hotel', hotel);
      if (query) params.set('q', query);
      setDetailData(await request('/progress/schools', params));
    } catch (e) { setDetailError(e.message || 'Daftar sekolah dari Revit belum dapat dimuat.'); }
    finally { setDetailLoading(false); }
  }
  function openSchoolDetail(metric, hotel = '') {
    setDetailContext({ metric, hotel });
    setDetailQuery('');
    setDetailData(null);
    loadSchoolDetail(metric, hotel);
  }
  function openRankingSchools(person, metric) {
    const assigned = person.schools ?? [...new Map(rankingData.schools
      .filter(school => school.venue === person.venue && school.lo === person.name)
      .map(school => [String(school.npsn), school])).values()];
    const schools = assigned.filter(school => metric === 'total' || schoolStatuses?.[school.npsn]?.stage === metric);
    setDetailContext({ metric, hotel: person.venue, name: person.name, schools });
    setDetailQuery('');
    setDetailLoading(false);
    setDetailError(metric !== 'total' && !schoolStatuses ? 'Status sekolah Revit belum tersedia. Coba muat ulang data Revit.' : '');
    showVerifierSchools(schools);
  }

  function showVerifierSchools(schools, page = 1, query = '') {
    const pageSize = 20;
    const search = query.trim().toLocaleLowerCase('id');
    const matches = schools.filter(school => [school.name, school.npsn].some(value => String(value ?? '').toLocaleLowerCase('id').includes(search)));
    const rows = matches.slice((page - 1) * pageSize, page * pageSize).map(school => ({
      ...school,
      kabKota: school.kab_kota,
      hotel: school.venue,
      status: schoolStatuses?.[school.npsn]?.label,
    }));
    setDetailData({ rows, pageSize, page, total: matches.length });
  }

  function loadSourceRankingAgain() {
    if (loView) loadGlobalRoster();
    setSourceRanking(null);
    loadSourceRanking();
    loadSchoolStatuses();
  }
  useEffect(() => { if (publicView || selectedEvent()?.id === 5) { load(); loadSource(); } }, []);
  useEffect(() => { if (loView && selectedEvent()?.id === 5) loadGlobalRoster(); }, [loView]);
  if (!publicView && selectedEvent()?.id !== 5) return <Navigate to="/admin/pelaporan" replace />;
  function changeArrivalFilter(label, byParticipant = false) {
    setArrivalFilter(label);
    setArrivalByParticipant(Boolean(label) && byParticipant);
    setPage(1);
  }
  function showAttendanceResults(label, byParticipant) {
    setView('schools');
    changeArrivalFilter(label, byParticipant);
    resultsRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'start',
    });
  }
  function reset() { setQuery(''); setVenue(''); setOwner(''); setVerifier(''); setStatus(''); changeArrivalFilter(''); }
  const showArrivalFilter = view === 'schools';
  const search = query.trim().toLocaleLowerCase('id');
  const verifiers = groupPksVerifiers(data?.verifiers, data?.schools);
  const rankingData = loView ? globalRoster : data;
  const rankingVerifiers = loView ? groupPksVerifiers(globalRoster?.verifiers, globalRoster?.schools) : verifiers;
  const rankingView = view === 'ranking' || view === 'verifierRanking';
  const filterData = rankingView && !loView ? rankingData : data;
  const verifierOptions = [...new Set((data?.schools || [])
    .filter(row => (!venue || row.venue === venue) && (!owner || row.lo === owner))
    .map(row => row.facilitator).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'id'));
  const verifierRanking = view === 'verifierRanking' && schoolStatuses && rankingData
    ? { owners: rankVerifiers(rankingVerifiers, rankingData.schools, schoolStatuses) }
    : null;
  const matchesDirectoryFilters = (row, rowView) => (!status || rowView !== 'schools' || schoolStatuses?.[row.npsn]?.stage === status)
    && (!verifier || rowView !== 'schools' || row.facilitator === verifier)
    && (!venue || row.venue === venue) && (!owner || (rowView === 'verifiers' ? row.los.includes(owner) : (rowView === 'lo' ? row.name : row.lo) === owner))
    && [row.npsn, row.name, row.provinsi, row.kab_kota, row.venue, row.facilitator, row.coordinator, row.head_name, row.lo, ...(row.los || []), row.pks?.nomor_pks]
      .some(value => String(value || '').toLocaleLowerCase('id').includes(search));
  const filteredSchools = showArrivalFilter ? (data?.schools || []).filter(row => matchesDirectoryFilters(row, 'schools')) : [];
  const rows = showArrivalFilter
    ? filteredSchools.filter(row => !arrivalFilter || (arrivalByParticipant
      ? participantStatusIndexes(row).includes(arrivalOptions.indexOf(arrivalFilter))
      : matchesArrival(row, arrivalFilter)))
    : (view === 'verifiers' ? verifiers : data?.[view] || []).filter(row => matchesDirectoryFilters(row, view));
  if (view === 'schools') {
    rows.sort((a, b) => personName(a.name).localeCompare(personName(b.name), 'id')
      || String(a.npsn).localeCompare(String(b.npsn)));
  }
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const active = Math.min(page, pages);
  const start = (active - 1) * pageSize;
  const filtered = query || venue || owner || (view === 'schools' && (status || verifier)) || (showArrivalFilter && arrivalFilter);
  const progressMetrics = new Map((sourceData?.metrics || []).map(item => [item.metric, item]));
  const progressTotal = progressMetrics.get('total')?.value || 0;
  return <div className="pks-page">
    <header className="pks-heading">
      <div><h1>Pantau Rekap PKS</h1><p>Satuan Pendidikan Aman Bencana <span>·</span> 23–28 November 2026</p></div>
      {data && <p className="pks-heading__meta">{data.venues.length} Venue <span>·</span> {data.lo.length} LO <span>·</span> {verifiers.length} Verifikator{!!data.coordinators?.length && <><span>·</span> {data.coordinators.length} Koordinator</>}</p>}
    </header>
    {!publicView && user?.role === 'admin' && <ArrivalImport onImported={load} />}
    {error && <div className="alert alert--err" role="alert">{error} {!data && <button className="btn btn--sm" onClick={load}>Coba lagi</button>}</div>}
    {!data && !error && <p role="status">Memuat pemetaan PKS…</p>}
    {data && <>
      <section className="pks-progress-source-panel" aria-label="Data progres dari dashboard SPAB">
        <div className="pks-progress-source-heading">
          <div><h2>Capaian Pendampingan BIMTEK</h2><p>Progres resmi dari dashboard Revit, diperbarui langsung dari sumber data.</p></div>
          <div><a className="pks-progress-source" href="https://revitsd.kemendikdasmen.go.id/spab/dashboard-progress" target="_blank" rel="noreferrer">Buka dashboard sumber</a><button type="button" className="btn btn--sm" onClick={loadSource}>Muat ulang</button></div>
        </div>
        {sourceLoading && <p role="status">Memuat progres dari dashboard SPAB…</p>}
        {sourceError && <div className="alert alert--err" role="alert">Data dashboard sumber belum dapat dimuat: {sourceError} <button className="btn btn--sm" onClick={loadSource}>Coba lagi</button></div>}
        {sourceData && <>
          <div className="pks-progress-cards">
            {progressMetricLabels.map(([key, fallback]) => {
              const metric = progressMetrics.get(key);
              return <article className="pks-progress-card" key={key}><span>{metric?.label || fallback}</span><button type="button" className="pks-progress-count" onClick={() => openSchoolDetail(key)} aria-label={`Lihat sekolah: ${metric?.label || fallback}`}><strong>{number.format(metric?.value || 0)}</strong></button><small>{metric?.percent || percent(metric?.value || 0, progressTotal)}</small></article>;
            })}
          </div>
          <div className="pks-progress-table-section">
            <div className="pks-progress-table-scroll" tabIndex={0} role="region" aria-label="Progres dashboard SPAB per venue">
              <table className="pks-progress-table">
                <colgroup><col className="pks-progress-hotel-column" />{progressMetricLabels.map(([key]) => <col key={key} />)}</colgroup>
                <thead>
                  <tr><th rowSpan="2" scope="col">Venue</th><th rowSpan="2" scope="col">Total sekolah</th>{progressGroups.map(group => <th className={group.className} colSpan={group.metrics.length} scope="colgroup" key={group.label}>{group.label}</th>)}<th rowSpan="2" scope="col">Tidak terdata</th></tr>
                  <tr>{progressMetricLabels.slice(1, -1).map(([key, label]) => <th scope="col" key={key}>{label}</th>)}</tr>
                </thead>
                <tbody>{sourceData.hotels.map(hotel => <tr key={hotel.hotel}><th scope="row">{hotel.hotel}</th>{progressMetricLabels.map(([key]) => { const value = hotel.metrics[key] || 0; return <td key={key}><button type="button" className="pks-progress-count" onClick={() => openSchoolDetail(key, hotel.hotel)} aria-label={`Lihat ${number.format(value)} sekolah: ${key} di ${hotel.hotel}`}><strong>{number.format(value)}</strong></button>{key !== 'tidak_terdata' && <small>{percent(value, hotel.metrics.total || 0)}</small>}</td>; })}</tr>)}</tbody>
                <tfoot><tr><th scope="row">TOTAL</th>{progressMetricLabels.map(([key]) => <td key={key}>{number.format(progressMetrics.get(key)?.value || 0)}</td>)}</tr></tfoot>
              </table>
            </div>
          </div>
          <div className="pks-progress-mobile">
            {sourceData.hotels.map((hotel, index) => (
              <MobileVenueProgress key={hotel.hotel} venue={hotel.hotel} open={index === 0}
                metrics={hotel.metrics} onShowSchools={openSchoolDetail} />
            ))}
            <MobileVenueProgress
              metrics={Object.fromEntries(progressMetricLabels.map(([key]) => [key, progressMetrics.get(key)?.value]))}
              onShowSchools={openSchoolDetail} />
          </div>
          <p className="pks-progress-footnote">Sumber data: <a href={sourceData.source} target="_blank" rel="noreferrer">revitsd.kemendikdasmen.go.id</a>{sourceData.updatedAt ? ` · diperbarui ${sourceData.updatedAt}` : ''}</p>
        </>}
      </section>
      <section className="pks-register" aria-label="Daftar pemetaan PKS">
        <div className="pks-register__head">
          <div className="pks-tabs" role="group" aria-label="Tampilan pemetaan">{Object.entries(views).map(([key, label]) => <button key={key} aria-pressed={view === key} onClick={() => { if (loView && rankingView !== (key === 'ranking' || key === 'verifierRanking')) reset(); setView(key); setPage(1); }}>{label}<span>{number.format(key === 'verifiers' ? verifiers.length : key === 'verifierRanking' ? rankingVerifiers.length : key === 'ranking' ? (rankingData?.lo.length ?? 0) : data[key].length)}</span></button>)}</div>
          <p>Status progres sekolah dari Dashboard Revit.</p>
        </div>
        <div className={`pks-filters${view === 'schools' ? ' pks-filters--schools' : ''}${showArrivalFilter ? ' pks-filters--with-arrival' : ''}`}>
          <FilterField label="Pencarian"><input type="search" value={query} placeholder={view === 'schools' ? 'Nama sekolah, NPSN, atau nomor PKS' : 'Cari nama atau venue'} onChange={e => { setQuery(e.target.value); setPage(1); }} /></FilterField>
          <FilterField label="Venue">
            <select value={venue} disabled={loView} onChange={e => { setVenue(e.target.value); setOwner(''); setVerifier(''); setPage(1); }}>
              {!loView && <option value="">Semua venue</option>}
              {loView && !venue && <option value="">Venue belum ditetapkan</option>}
              {(filterData?.venues || []).map(name => <option key={name}>{name}</option>)}
            </select>
          </FilterField>
          <FilterField label="LO bertugas">
            <select value={owner} disabled={loView} onChange={e => { setOwner(e.target.value); setVerifier(''); setPage(1); }}>
              {!loView && <option value="">Semua LO</option>}
              {loView && !owner && <option value="">Penugasan LO belum tersedia</option>}
              {(filterData?.lo || []).filter(row => !venue || row.venue === venue).map(row => <option value={row.name} key={row.venue + row.name}>{personName(row.name)}</option>)}
            </select>
          </FilterField>
          {view === 'schools' && <FilterField label="Verifikator">
            <select value={verifier} onChange={e => { setVerifier(e.target.value); setPage(1); }}>
              <option value="">Semua verifikator</option>
              {verifierOptions.map(name => <option key={name} value={name}>{personName(name)}</option>)}
            </select>
          </FilterField>}
          {view === 'schools' && <FilterField label="Status">
            <select value={status} disabled={!schoolStatuses || schoolStatusesError} onChange={e => { setStatus(e.target.value); setPage(1); }}>
              <option value="">Semua status</option>
              {progressMetricLabels.slice(1, -1).map(([key, label]) => (
                <option key={key} value={key}>{label.replace(/^\d+\.\s*/, '')}</option>
              ))}
            </select>
          </FilterField>}
          {showArrivalFilter && <FilterField label="Kehadiran">
            <select value={arrivalFilter} onChange={e => changeArrivalFilter(e.target.value)}>
              <option value="">Semua kehadiran</option>
              {arrivalOptions.map(label => <option key={label}>{label}</option>)}
            </select>
          </FilterField>}
        </div>
        {rankingView && loView && !ownLo ? <p role="status">Penugasan LO belum tersedia.</p> : rankingView && !rankingData ? (globalRosterError ? <p role="alert">{globalRosterError} <button type="button" onClick={loadGlobalRoster}>Coba lagi</button></p> : <p role="status">Memuat data peringkat…</p>) : view === 'verifierRanking' ? <PksRanking verifierMode onShowSchools={openRankingSchools} data={rankingData} venue={venue} query={search} owner={owner} sourceRanking={verifierRanking} sourceRankingLoading={!schoolStatuses && !schoolStatusesError} sourceRankingError={schoolStatusesError ? 'Peringkat Verifikator dari Revit belum dapat dimuat.' : ''} onReloadSourceRanking={loadSchoolStatuses} /> : view === 'ranking' ? <PksRanking publicView={publicView} onShowSchools={openRankingSchools} data={rankingData} venue={venue} query={search} owner={owner} onReload={loView ? loadGlobalRoster : load} sourceRanking={sourceRanking} sourceRankingError={sourceRankingError} sourceRankingLoading={sourceRankingLoading} onLoadSourceRanking={loadSourceRanking} onReloadSourceRanking={loadSourceRankingAgain} /> : <>
        {showArrivalFilter && <PksAttendanceSummary schools={filteredSchools} onSelect={showAttendanceResults}
          arrivalFilter={arrivalFilter} arrivalByParticipant={arrivalByParticipant} />}
        <div ref={resultsRef} className="pks-results"><span><b>{number.format(rows.length)}</b> {view === 'schools' ? 'sekolah' : view === 'verifiers' ? 'verifikator' : 'LO'}{filtered ? ' sesuai filter' : ''}</span>{filtered && <button type="button" onClick={reset}>Reset filter</button>}</div>
        <div className="pks-table-scroll" tabIndex={0} role="region" aria-label={`Tabel ${views[view]}`}>
          <table className={`table pks-table${view !== 'schools' ? ` pks-table--people${view === 'verifiers' ? ' pks-table--verifiers' : ''}` : ''}`}>
            <thead><tr>{(view === 'schools' ? ['Sekolah / NPSN', 'Wilayah', 'Venue', 'Verifikator', 'LO bertugas', 'Status', 'Kehadiran'] : ['Nama', 'Venue', ...(view === 'verifiers' ? ['Koordinator', 'LO bertugas'] : [])]).map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{rows.slice(start, start + pageSize).map(row => <tr className={view === 'schools' ? 'pks-school-card' : undefined} key={row.npsn || `${row.venue}:${row.name}:${row.lo || ''}`}>
              {view === 'schools' ? <>
                <td className="pks-school-identity" data-label="Sekolah"><b>{personName(row.name)}</b><small className="pks-npsn">NPSN {row.npsn}</small><div className="pks-school-head">{row.head_name && <small>Kepala Sekolah <strong>{personName(row.head_name)}</strong></small>}<Contact phone={row.head_phone} name={row.head_name} /></div></td>
                <td className="pks-school-region" data-label="Wilayah">{row.kab_kota}<small>{row.provinsi}</small></td><td className="pks-school-venue" data-label="Venue"><span className="pks-venue-name">{row.venue}</span></td>
                <td className="pks-school-support" data-label="Verifikator"><b>{personName(row.facilitator)}</b><Contact phone={row.facilitator_phone} email={row.facilitator_email} name={row.facilitator} /><div className="pks-school-coordinator">{row.coordinator && <small>Koordinator <strong>{personName(row.coordinator)}</strong></small>}<Contact phone={row.coordinator_phone} email={row.coordinator_email} name={row.coordinator} /></div></td><td className="pks-school-lo" data-label="LO bertugas"><div className="pks-verifier-los"><span>{personName(row.lo)}<LoRepresentation name={row.lo}/></span></div></td>
                <td className="pks-school-status" data-label="Status"><SchoolRevitStatus status={schoolStatuses?.[row.npsn]} loading={!schoolStatuses} failed={schoolStatusesError} />{(row.bimtek?.note || row.pks?.catatan) && <small>Catatan: {[row.bimtek?.note,row.pks?.catatan].filter(Boolean).join(' · ')}</small>}</td>
                <td className="pks-school-arrival" data-label="Kehadiran">
                  {row.arrival_attendees?.length ? [...row.arrival_attendees]
                    .sort((a, b) => (arrivalRoleOrder[a.role] ?? 2) - (arrivalRoleOrder[b.role] ?? 2))
                    .map(attendee => (
                    <div key={attendee.name}>
                      <small>{attendee.role}</small>
                      <b>{personName(attendee.name)}</b>
                      <ArrivalChip status={attendee.status} />
                    </div>
                  )) : row.arrival_statuses?.length
                    ? row.arrival_statuses.map(status => <div key={status}><ArrivalChip status={status} /></div>)
                    : <ArrivalChip status={row.arrival_status} />}
                </td>
              </> : <>
                <td className="pks-person-cell" data-label={view === 'verifiers' ? 'Verifikator' : 'LO'}><span className="pks-person-avatar" aria-hidden="true">{personName(row.name).split(/\s+/).slice(0, 2).map(word => word[0]).join('')}</span><b>{personName(row.name)}</b><LoRepresentation name={row.name}/><Contact phone={row.phone} email={row.email} name={row.name} /></td>
                <td data-label="Venue"><span className="pks-venue-name">{row.venue}</span></td>
                {view === 'verifiers' && <>
                  <td className="pks-coordinator-cell" data-label="Koordinator"><b>{personName(row.coordinator) || '—'}</b><Contact phone={row.coordinator_phone} email={row.coordinator_email} name={row.coordinator} /></td>
                  <td data-label="LO bertugas"><div className="pks-verifier-los">{row.los.map(name => <span key={name}>{personName(name)}<LoRepresentation name={name}/></span>)}</div></td>
                </>}
              </>}
            </tr>)}</tbody>
          </table>
          {!rows.length && <div className="pks-empty"><b>Tidak ada hasil</b><p>Coba kata pencarian lain atau ubah filter.</p><button className="btn btn--sm" onClick={reset}>Reset filter</button></div>}
        </div>
        <footer className="pks-pagination"><span>{rows.length ? `${number.format(start + 1)}–${number.format(Math.min(start + pageSize, rows.length))}` : '0'} dari {number.format(rows.length)}</span><label>Baris<select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>{[25, 50, 100].map(size => <option key={size}>{size}</option>)}</select></label><nav aria-label="Halaman rekap PKS"><button className="btn btn--sm" disabled={active <= 1} onClick={() => setPage(active - 1)}>Sebelumnya</button><span>{active} / {pages}</span><button className="btn btn--sm" disabled={active >= pages} onClick={() => setPage(active + 1)}>Berikutnya</button></nav></footer>
        </>}
      </section>
      <p className="pks-footnote">Pemetaan sekolah mencakup {data.verifiers.length} penugasan LO–verifikator.</p>
    </>}
    {detailContext && <ProgressSchoolsDialog
      context={detailContext}
      data={detailData}
      error={detailError}
      loading={detailLoading}
      query={detailQuery}
      onQueryChange={setDetailQuery}
      onClose={() => { setDetailContext(null); setDetailData(null); setDetailError(''); }}
      onSearch={() => detailContext.schools
        ? showVerifierSchools(detailContext.schools, 1, detailQuery)
        : loadSchoolDetail(detailContext.metric, detailContext.hotel, 1, detailQuery.trim())}
      onPage={(page) => detailContext.schools
        ? showVerifierSchools(detailContext.schools, page, detailQuery)
        : loadSchoolDetail(detailContext.metric, detailContext.hotel, page, detailQuery.trim())}
    />}
  </div>;
}

function MobileVenueProgress({ venue, metrics, open, onShowSchools }) {
  const groups = [
    { metrics: ['total'] },
    ...progressGroups,
    { metrics: ['tidak_terdata'] },
  ];
  const total = metrics.total || 0;
  const venueLabel = venue || 'Semua venue';
  const labels = new Map(progressMetricLabels);

  return <details className="pks-progress-mobile__venue" open={open}>
    <summary>{venueLabel} <small>{number.format(total)} sekolah</small></summary>
    {groups.map(group => (
      <div key={group.metrics[0]}>
        {group.label && <h3 className={group.className}>{group.label}</h3>}
        <dl>
          {group.metrics.map(key => {
            const value = metrics[key] || 0;
            const label = labels.get(key);
            return <div key={key}>
              <dt>{label}</dt>
              <dd>
                <button type="button" className="pks-progress-count"
                  onClick={() => onShowSchools(key, venue)}
                  aria-label={`Lihat ${number.format(value)} sekolah: ${label} · ${venueLabel}`}>
                  <strong>{number.format(value)}</strong>
                </button>
                {key !== 'tidak_terdata' && <small>{percent(value, total)}</small>}
              </dd>
            </div>;
          })}
        </dl>
      </div>
    ))}
  </details>;
}

function SchoolRevitStatus({ status, loading, failed }) {
  if (failed) return <span>Data Revit gagal dimuat</span>;
  if (loading) return <span>Memuat status Revit…</span>;
  if (!status) return <span>NPSN tidak ditemukan di Revit</span>;
  const hasStageGroup = progressGroups.some(({ metrics }) => metrics.includes(status.stage));
  const label = progressMetricLabels.find(([key]) => key === status.stage)?.[1].replace(/^\d+\.\s*/, '');
  return <div className="pks-revit-school-stage">
    {progressGroups.map(({ label: group, metrics }) => (
      <div key={group}>
        <small>Status {group === 'RAB & BA' ? 'RAB' : group}</small>
        <strong>{metrics.includes(status.stage) ? label : '—'}</strong>
      </div>
    ))}
    {!hasStageGroup && <small>{label || status.label || 'Status belum tersedia'}</small>}
  </div>;
}

function ProgressSchoolsDialog({ context, data, error, loading, query, onQueryChange, onClose, onSearch, onPage }) {
  const metricLabel = progressMetricLabels.find(([key]) => key === context.metric)?.[1] || context.metric;
  const pages = Math.max(1, Math.ceil((data?.total || 0) / (data?.pageSize || 20)));
  const start = data?.total ? ((data.page - 1) * data.pageSize) + 1 : 0;
  const end = Math.min(data?.total || 0, (data?.page || 1) * (data?.pageSize || 20));
  return <div className="pks-progress-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="pks-progress-dialog" role="dialog" aria-modal="true" aria-labelledby="pks-progress-dialog-title">
      <header className="pks-progress-dialog__header">
        <div><p className="pks-progress-dialog__eyebrow">Detail progres Revit</p><h2 id="pks-progress-dialog-title">{metricLabel}</h2><p>{[context.name, context.hotel || 'Semua hotel'].filter(Boolean).join(' · ')}</p></div>
        <button type="button" className="pks-progress-dialog__close" onClick={onClose} aria-label="Tutup dialog">×</button>
      </header>
      <form className="pks-progress-dialog__search" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
        <input type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Cari nama sekolah atau NPSN" aria-label="Cari sekolah" />
        <button type="submit" className="btn btn--primary">Cari</button>
      </form>
      {error && <div className="alert alert--err" role="alert">{error}</div>}
      {loading && <p className="pks-progress-dialog__status" role="status">Memuat daftar sekolah…</p>}
      {!loading && data && <>
        <div className="pks-progress-dialog__table-wrap">
          <table className="pks-progress-dialog__table">
            <thead><tr><th>Sekolah</th><th>Kab/Kota</th><th>Hotel</th><th>Status</th></tr></thead>
            <tbody>{data.rows.map((row) => {
              const status = (row.status ?? '').replace(/^\s*Bantuan\s+SPAB\b\s*/i, '').trim();
              return <tr key={row.npsn}>
                <td><strong>{row.name}</strong><small>NPSN {row.npsn}</small></td>
                <td>{row.kabKota}</td>
                <td>{row.hotel}</td>
                <td><span>{status || '—'}</span></td>
              </tr>;
            })}</tbody>
          </table>
          {!data.rows.length && <p className="pks-progress-dialog__empty">Tidak ada sekolah yang cocok.</p>}
        </div>
        <footer className="pks-progress-dialog__footer">
          <span>{start}–{end} dari {number.format(data.total)} sekolah</span>
          <nav aria-label="Halaman daftar sekolah"><button type="button" className="btn btn--sm" disabled={data.page <= 1 || loading} onClick={() => onPage(data.page - 1)}>Sebelumnya</button><span>{data.page} / {pages}</span><button type="button" className="btn btn--sm" disabled={data.page >= pages || loading} onClick={() => onPage(data.page + 1)}>Berikutnya</button></nav>
        </footer>
      </>}
    </section>
  </div>;
}
