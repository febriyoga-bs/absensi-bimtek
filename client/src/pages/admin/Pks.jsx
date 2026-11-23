import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api.js';
import { selectedEvent } from '../../event.js';
import { personName } from '../../lib/personName.js';
import { groupPksVerifiers } from '../../lib/pksVerifiers.js';
import FilterField from '../../components/FilterField.jsx';
import PksRanking from './PksRanking.jsx';
import WhatsAppLink from '../../components/WhatsAppLink.jsx';
import './Pks.css';

const statuses = { belum_diterima: 'Belum diterima', menunggu_verifikasi: 'Menunggu verifikasi', perlu_perbaikan: 'Perlu perbaikan', lengkap: 'Lengkap' };
const views = { schools: 'Sekolah', verifiers: 'Verifikator', lo: 'LO', ranking: 'Peringkat LO' };
const number = new Intl.NumberFormat('id-ID');

function Contact({ phone, email, name }) {
  return <>{phone && <small>{phone} <WhatsAppLink phone={phone} name={name} /></small>}{email && <small>{email}</small>}</>;
}

export default function Pks() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [venue, setVenue] = useState('');
  const [owner, setOwner] = useState('');
  const [view, setView] = useState('schools');
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const dialog = useRef(null);
  async function load() {
    setError('');
    try { setData(await api('/admin/pks', { admin: true })); } catch (e) { setError(e.message); }
  }
  useEffect(() => { if (selectedEvent()?.id === 5) load(); }, []);
  useEffect(() => {
    if (editing && dialog.current && !dialog.current.open) dialog.current.showModal();
    else if (!editing && dialog.current?.open) dialog.current.close();
  }, [editing]);
  if (selectedEvent()?.id !== 5) return <Navigate to="/admin/pelaporan" replace />;
  async function save(e) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      const record = await api(`/admin/pks/${editing.npsn}`, { admin: true, method: 'PUT', body: editing.pks });
      setData(current => ({ ...current, schools: current.schools.map(s => s.npsn === editing.npsn ? { ...s, pks: record } : s) }));
      setEditing(null);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }
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
  const setField = (key, value) => setEditing(current => ({ ...current, pks: { ...current.pks, [key]: value } }));
  return <div className="pks-page">
    <header className="pks-heading">
      <div><h1>Pantau Rekap PKS</h1><p>Satuan Pendidikan Aman Bencana <span>·</span> 23–28 November 2026</p></div>
      {data && <p className="pks-heading__meta">{data.venues.length} Venue <span>·</span> {data.lo.length} LO <span>·</span> {verifiers.length} Verifikator{!!data.coordinators?.length && <><span>·</span> {data.coordinators.length} Koordinator</>}</p>}
    </header>
    {error && !editing && <div className="alert alert--err" role="alert">{error} {!data && <button className="btn btn--sm" onClick={load}>Coba lagi</button>}</div>}
    {!data && !error && <p role="status">Memuat pemetaan PKS…</p>}
    {data && <>
      <section className="pks-summary" aria-label="Ringkasan status PKS">
        <button className="pks-summary__total" aria-pressed={!status} onClick={() => { setStatus(''); setView('schools'); setPage(1); }}><span>Total sekolah</span><b>{number.format(data.schools.length)}</b></button>
        {Object.entries(statuses).map(([key, label]) => <button key={key} data-status={key} aria-pressed={status === key} onClick={() => { setStatus(status === key ? '' : key); setView('schools'); setPage(1); }}><span>{label}</span><b>{number.format(data.schools.filter(s => s.pks.status === key).length)}</b></button>)}
      </section>
      <section className="pks-register" aria-label="Daftar pemetaan PKS">
        <div className="pks-register__head">
          <div className="pks-tabs" role="group" aria-label="Tampilan pemetaan">{Object.entries(views).map(([key, label]) => <button key={key} aria-pressed={view === key} onClick={() => { setView(key); setPage(1); }}>{label}<span>{number.format(key === 'verifiers' ? verifiers.length : key === 'ranking' ? data.lo.length : data[key].length)}</span></button>)}</div>
          <p>Status dokumen diperbarui berdasarkan pemeriksaan PKS.</p>
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
            <thead><tr>{(view === 'schools' ? ['Sekolah / NPSN', 'Wilayah', 'Venue', 'Verifikator', 'LO bertugas', 'Status PKS', 'Tindakan'] : ['Nama', 'Venue', ...(view === 'verifiers' ? ['Koordinator', 'LO bertugas'] : [])]).map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{rows.slice(start, start + pageSize).map(row => <tr key={row.npsn || `${row.venue}:${row.name}:${row.lo || ''}`}>
              {view === 'schools' ? <>
                <td><b>{personName(row.name)}</b><small className="pks-npsn">{row.npsn}</small>{row.head_name && <small>Kepsek: {personName(row.head_name)}</small>}<Contact phone={row.head_phone} name={row.head_name} /></td>
                <td>{row.kab_kota}<small>{row.provinsi}</small></td><td>{row.venue}</td>
                <td>{personName(row.facilitator)}<Contact phone={row.facilitator_phone} email={row.facilitator_email} name={row.facilitator} />{row.coordinator && <small>Koordinator: {personName(row.coordinator)}</small>}<Contact phone={row.coordinator_phone} email={row.coordinator_email} name={row.coordinator} /></td><td>{personName(row.lo)}</td>
                <td><span className="pks-status" data-status={row.pks.status}>{statuses[row.pks.status]}</span></td>
                <td><button className="pks-edit" onClick={() => { setEditing({ ...row, pks: { ...row.pks } }); setError(''); }} aria-label={`Perbarui PKS ${row.name}`}>Perbarui</button></td>
              </> : <>
                <td><b>{personName(row.name)}</b><Contact phone={row.phone} email={row.email} name={row.name} /></td>
                <td>{row.venue}</td>
                {view === 'verifiers' && <>
                  <td><b>{personName(row.coordinator) || '—'}</b><Contact phone={row.coordinator_phone} email={row.coordinator_email} name={row.coordinator} /></td>
                  <td><div className="pks-verifier-los">{row.los.map(name => personName(name)).join(', ')}</div></td>
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
    <dialog ref={dialog} className="pks-dialog" aria-labelledby="pks-edit-title" onCancel={e => { if (saving) e.preventDefault(); }} onClose={() => { setEditing(null); setError(''); }}>
      {editing && <form onSubmit={save}>
        <header><div><h2 id="pks-edit-title">Perbarui PKS</h2><p>{personName(editing.name)} <span>NPSN {editing.npsn}</span></p></div><button type="button" className="pks-dialog__close" aria-label="Tutup formulir" disabled={saving} onClick={() => setEditing(null)}>×</button></header>
        <div className="pks-dialog__body">
          {error && <p role="alert" className="alert alert--err">{error}</p>}
          <div className="pks-form-grid">
            <FilterField label="Status PKS"><select autoFocus value={editing.pks.status} onChange={e => setField('status', e.target.value)}>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></FilterField>
            <FilterField label="Nomor PKS"><input value={editing.pks.nomor_pks || ''} maxLength={200} required={editing.pks.status === 'lengkap'} onChange={e => setField('nomor_pks', e.target.value)} /></FilterField>
            {[['tanggal_diterima', 'Tanggal diterima'], ['tanggal_ttd', 'Tanggal tanda tangan']].map(([key, label]) => <FilterField key={key} label={label}><input type="date" required={editing.pks.status === 'lengkap'} value={editing.pks[key] || ''} onChange={e => setField(key, e.target.value)} /></FilterField>)}
            <label className="pks-form-notes">Catatan pemeriksaan / perbaikan<textarea rows={4} maxLength={4000} value={editing.pks.catatan || ''} onChange={e => setField('catatan', e.target.value)} /></label>
          </div>
          <p className="pks-form-hint">Untuk status lengkap, isi nomor PKS serta kedua tanggal.</p>
          {editing.pks.updated_at && <p className="pks-form-hint">Terakhir diperbarui {editing.pks.updated_by} · {new Date(editing.pks.updated_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</p>}
        </div>
        <footer><button className="btn" type="button" disabled={saving} onClick={() => setEditing(null)}>Batal</button><button className="btn btn--primary" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan perubahan'}</button></footer>
      </form>}
    </dialog>
  </div>;
}
