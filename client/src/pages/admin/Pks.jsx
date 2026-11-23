import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api.js';
import { selectedEvent } from '../../event.js';
import { personName } from '../../lib/personName.js';
import { groupPksVerifiers } from '../../lib/pksVerifiers.js';
import FilterField from '../../components/FilterField.jsx';
import PksRanking from './PksRanking.jsx';
import WhatsAppLink from '../../components/WhatsAppLink.jsx';
import './Pks.css';
import { BimtekSummary } from './PksBimtek.jsx';
import { schoolInspectionItems } from '../../lib/pksInspection.js';
import PksMetricInfo from './PksMetricInfo.jsx';

const statuses = { belum_diterima: 'Belum diterima', menunggu_verifikasi: 'Menunggu verifikasi', perlu_perbaikan: 'Perlu perbaikan', lengkap: 'Lengkap' };
const views = { schools: 'Sekolah', verifiers: 'Verifikator', lo: 'LO', ranking: 'Peringkat LO' };
const number = new Intl.NumberFormat('id-ID');

function Contact({ phone, email, name }) {
  return <>{phone && <small className="pks-contact-phone"><span>{phone}</span><WhatsAppLink phone={phone} name={name} /></small>}{email && <small className="pks-contact-email"><a href={`mailto:${email}`}>{email}</a></small>}</>;
}

export default function Pks() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [venue, setVenue] = useState('');
  const [owner, setOwner] = useState('');
  const [view, setView] = useState('schools');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  async function load() {
    setError('');
    try { setData(await api('/admin/pks', { admin: true })); } catch (e) { setError(e.message); }
  }
  useEffect(() => { if (selectedEvent()?.id === 5) load(); }, []);
  if (selectedEvent()?.id !== 5) return <Navigate to="/admin/pelaporan" replace />;
  function reset() { setQuery(''); setVenue(''); setOwner(''); setStatus(''); setPage(1); }
  const search = query.trim().toLocaleLowerCase('id');
  const verifiers = groupPksVerifiers(data?.verifiers, data?.schools);
  const rows = (view === 'verifiers' ? verifiers : data?.[view] || []).filter(row => (!status || view !== 'schools' || row.pks.status === status)
    && (!venue || row.venue === venue) && (!owner || (view === 'verifiers' ? row.los.includes(owner) : (view === 'lo' ? row.name : row.lo) === owner))
    && [row.npsn, row.name, row.provinsi, row.kab_kota, row.venue, row.facilitator, row.coordinator, row.head_name, row.lo, ...(row.los || []), row.pks?.nomor_pks]
      .some(value => String(value || '').toLocaleLowerCase('id').includes(search)));
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const active = Math.min(page, pages);
  const start = (active - 1) * pageSize;
  const filtered = query || venue || owner || (view === 'schools' && status);
  return <div className="pks-page">
    <header className="pks-heading">
      <div><h1>Pantau Rekap PKS</h1><p>Satuan Pendidikan Aman Bencana <span>·</span> 23–28 November 2026</p></div>
      {data && <p className="pks-heading__meta">{data.venues.length} Venue <span>·</span> {data.lo.length} LO <span>·</span> {verifiers.length} Verifikator{!!data.coordinators?.length && <><span>·</span> {data.coordinators.length} Koordinator</>}</p>}
    </header>
    {error && <div className="alert alert--err" role="alert">{error} {!data && <button className="btn btn--sm" onClick={load}>Coba lagi</button>}</div>}
    {!data && !error && <p role="status">Memuat pemetaan PKS…</p>}
    {data && <>
      <BimtekSummary schools={data.schools.filter(row => (!venue || row.venue === venue) && (!owner || row.lo === owner))} />
      <section className="pks-register" aria-label="Daftar pemetaan PKS">
        <div className="pks-register__head">
          <div className="pks-tabs" role="group" aria-label="Tampilan pemetaan">{Object.entries(views).map(([key, label]) => <button key={key} aria-pressed={view === key} onClick={() => { setView(key); setPage(1); }}>{label}<span>{number.format(key === 'verifiers' ? verifiers.length : key === 'ranking' ? data.lo.length : data[key].length)}</span></button>)}</div>
          <p>Monitoring hasil pemeriksaan dari dashboard verifikasi.</p>
        </div>
        <div className="pks-filters">
          <FilterField label="Pencarian"><input type="search" value={query} placeholder={view === 'schools' ? 'Nama sekolah, NPSN, atau nomor PKS' : 'Cari nama atau venue'} onChange={e => { setQuery(e.target.value); setPage(1); }} /></FilterField>
          <FilterField label="Venue"><select value={venue} onChange={e => { setVenue(e.target.value); setOwner(''); setPage(1); }}><option value="">Semua venue</option>{data.venues.map(name => <option key={name}>{name}</option>)}</select></FilterField>
          <FilterField label="LO bertugas"><select value={owner} onChange={e => { setOwner(e.target.value); setPage(1); }}><option value="">Semua LO</option>{data.lo.filter(row => !venue || row.venue === venue).map(row => <option value={row.name} key={row.venue + row.name}>{personName(row.name)}</option>)}</select></FilterField>
          {view === 'schools' && <FilterField label="Status PKS"><select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">Semua status</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></FilterField>}
        </div>
        {view === 'ranking' ? <PksRanking data={data} venue={venue} query={search} owner={owner} onReload={load} /> : <>
        <div className="pks-results"><span><b>{number.format(rows.length)}</b> {view === 'schools' ? 'sekolah' : view === 'verifiers' ? 'verifikator' : 'LO'}{filtered ? ' sesuai filter' : ''}</span>{filtered && <button type="button" onClick={reset}>Reset filter</button>}</div>
        <div className="pks-table-scroll" tabIndex={0} role="region" aria-label={`Tabel ${views[view]}`}>
          <table className={`table pks-table${view !== 'schools' ? ` pks-table--people${view === 'verifiers' ? ' pks-table--verifiers' : ''}` : ''}`}>
            <thead><tr>{(view === 'schools' ? ['Sekolah / NPSN', 'Wilayah', 'Venue', 'Verifikator', 'LO bertugas', 'Hasil Pemeriksaan'] : ['Nama', 'Venue', ...(view === 'verifiers' ? ['Koordinator', 'LO bertugas'] : [])]).map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{rows.slice(start, start + pageSize).map(row => <tr className={view === 'schools' ? 'pks-school-card' : undefined} key={row.npsn || `${row.venue}:${row.name}:${row.lo || ''}`}>
              {view === 'schools' ? <>
                <td className="pks-school-identity" data-label="Sekolah"><b>{personName(row.name)}</b><small className="pks-npsn">NPSN {row.npsn}</small><div className="pks-school-head">{row.head_name && <small>Kepala Sekolah <strong>{personName(row.head_name)}</strong></small>}<Contact phone={row.head_phone} name={row.head_name} /></div></td>
                <td className="pks-school-region" data-label="Wilayah">{row.kab_kota}<small>{row.provinsi}</small></td><td className="pks-school-venue" data-label="Venue"><span className="pks-venue-name">{row.venue}</span></td>
                <td className="pks-school-support" data-label="Verifikator"><b>{personName(row.facilitator)}</b><Contact phone={row.facilitator_phone} email={row.facilitator_email} name={row.facilitator} /><div className="pks-school-coordinator">{row.coordinator && <small>Koordinator <strong>{personName(row.coordinator)}</strong></small>}<Contact phone={row.coordinator_phone} email={row.coordinator_email} name={row.coordinator} /></div></td><td className="pks-school-lo" data-label="LO bertugas"><div className="pks-verifier-los"><span>{personName(row.lo)}</span></div></td>
                <td className="pks-school-status" data-label="Hasil pemeriksaan"><dl className="pks-inspection-list">{schoolInspectionItems(row).map(item=><PksMetricInfo key={item.metric} metric={item.metric} label={item.label} context={`${row.name} · NPSN ${row.npsn}`} schoolLevel><span className="pks-inspection-value">{item.status}</span></PksMetricInfo>)}</dl>{(row.bimtek?.note || row.pks?.catatan) && <small>Catatan: {[row.bimtek?.note,row.pks?.catatan].filter(Boolean).join(' · ')}</small>}</td>
              </> : <>
                <td className="pks-person-cell" data-label={view === 'verifiers' ? 'Verifikator' : 'LO'}><span className="pks-person-avatar" aria-hidden="true">{personName(row.name).split(/\s+/).slice(0, 2).map(word => word[0]).join('')}</span><b>{personName(row.name)}</b><Contact phone={row.phone} email={row.email} name={row.name} /></td>
                <td data-label="Venue"><span className="pks-venue-name">{row.venue}</span></td>
                {view === 'verifiers' && <>
                  <td className="pks-coordinator-cell" data-label="Koordinator"><b>{personName(row.coordinator) || '—'}</b><Contact phone={row.coordinator_phone} email={row.coordinator_email} name={row.coordinator} /></td>
                  <td data-label="LO bertugas"><div className="pks-verifier-los">{row.los.map(name => <span key={name}>{personName(name)}</span>)}</div></td>
                </>}
              </>}
            </tr>)}</tbody>
          </table>
          {!rows.length && <div className="pks-empty"><b>Tidak ada hasil</b><p>Coba kata pencarian lain atau ubah filter.</p><button className="btn btn--sm" onClick={reset}>Reset filter</button></div>}
        </div>
        <footer className="pks-pagination"><span>{rows.length ? `${number.format(start + 1)}–${number.format(Math.min(start + pageSize, rows.length))}` : '0'} dari {number.format(rows.length)}</span><label>Baris<select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>{[25, 50, 100].map(size => <option key={size}>{size}</option>)}</select></label><nav aria-label="Halaman rekap PKS"><button className="btn btn--sm" disabled={active <= 1} onClick={() => setPage(active - 1)}>Sebelumnya</button><span>{active} / {pages}</span><button className="btn btn--sm" disabled={active >= pages} onClick={() => setPage(active + 1)}>Berikutnya</button></nav></footer>
        </>}
      </section>
      <p className="pks-footnote">Pemetaan sekolah mencakup {data.verifiers.length} penugasan LO–verifikator. Status awal dokumen: belum diterima.</p>
    </>}
  </div>;
}
