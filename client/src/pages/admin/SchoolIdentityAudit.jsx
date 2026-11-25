import {useState} from 'react';
import {api} from '../../api.js';
import SchoolArrivalCorrection from './SchoolArrivalCorrection.jsx';

const labels={HEAD_ON_TREASURER:'Kepala sekolah tertaut ke bendahara',DUPLICATE_PROFILE_NAME:'Nama pada beberapa profil',
  AMBIGUOUS_SCHOOL_NAME:'Nama sekolah sama pada beberapa NPSN',
  SOURCE_PROFILE_ARRIVAL_MISMATCH:'Kedatangan sumber belum terhubung ke profil',
  SOURCE_HEAD_ROLE:'Peran kepala sekolah berbeda',UNRESOLVED_HEAD_IDENTITY:'Identitas kepala sekolah perlu diperiksa',
  MORE_THAN_TWO_SOURCE_NAMES:'Lebih dari dua nama di sumber'};
const formatDate=value=>new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(value))+' WIB';
const number=new Intl.NumberFormat('id-ID');
const pageSize=25;
function download(report) {
  const cell=value=>'"'+String(value ?? '').replace(/^[\s]*[=+@-]/,'\'$&').replace(/"/g,'""')+'"';
  const csv=[['Kategori','NPSN','Sekolah','Venue','Kepala sekolah','Temuan'],...report.findings.map(f=>[
    labels[f.type] || f.type,f.npsn,f.school,f.venue,f.head_name,f.evidence])].map(row=>row.map(cell).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`audit-identitas-sekolah-${report.created_at.replace(/[:.]/g,'-')}.csv`;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function SchoolIdentityAudit({initialReport=null,onCorrected}) {
  const [report,setReport]=useState(initialReport),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [editing,setEditing]=useState(null);
  const [type,setType]=useState(''),[venue,setVenue]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(0);
  async function run() {
    if (editing) return;
    setBusy(true);setError('');setReport(null);setPage(0);setType('');setVenue('');setSearch('');
    try {setReport(await api('/admin/school-identity-audit',{admin:true}));}
    catch(e) {setError(e.message || 'Audit gagal dimuat. Coba lagi.');}
    finally {setBusy(false);}
  }
  async function corrected() {
    const refreshed=await api('/admin/school-identity-audit',{admin:true});
    setReport(refreshed);setEditing(null);setPage(0);
    await onCorrected?.();
  }
  const filtered=(report?.findings || []).filter(f=>(!type || f.type===type) && (!venue || f.venue===venue)
    && `${f.npsn} ${f.school} ${f.head_name} ${f.evidence}`.toLocaleLowerCase('id').includes(search.toLocaleLowerCase('id').trim()));
  return <section className="pks-progress-source-panel school-identity-audit" aria-label="Audit Data">
    <div className="pks-progress-source-heading">
      <div><h2>Audit Data</h2><p>Periksa identitas kepala sekolah, bendahara, dan tautan kedatangan. Perubahan hanya disimpan melalui tombol koreksi.</p></div>
      <button type="button" className="btn btn--sm" disabled={busy} onClick={run}>{busy?'Memeriksa data…':report?'Audit ulang':'Jalankan audit'}</button>
    </div>
    {busy && <p role="status">Memeriksa seluruh sekolah dan profil absensi…</p>}
    {error && <p className="alert alert--err" role="alert">{error}</p>}
    {editing && <SchoolArrivalCorrection key={editing.npsn} school={editing} onSaved={corrected} onCancel={()=>setEditing(null)} />}
    {report && <>
      <p className="muted small">Diperiksa: {formatDate(report.created_at)} · {number.format(report.schools)} sekolah · {number.format(report.profiles)} profil.
        {report.imported_at && <> Impor kehadiran terakhir: {formatDate(report.imported_at)}.</>}</p>
      {!report.has_arrival_data && <p className="alert alert--warn">Belum ada rekap kehadiran yang diimpor. Temuan terkait sumber kedatangan belum dapat diperiksa.</p>}
      <p><strong>{number.format(report.affected_schools)} sekolah</strong> memiliki {number.format(report.findings.length)} temuan.
        {' '}Temuan adalah indikasi untuk diperiksa, bukan semuanya kesalahan yang sudah terkonfirmasi.</p>
      <div className="school-audit-filters">
        <label>Pencarian<input value={search} placeholder="Nama, NPSN, atau sekolah" onChange={e=>{setSearch(e.target.value);setPage(0);}} /></label>
        <label>Kategori<select value={type} onChange={e=>{setType(e.target.value);setPage(0);}}><option value="">Semua kategori</option>
          {Object.entries(report.counts).map(([key,count])=><option key={key} value={key}>{labels[key] || key} ({count})</option>)}</select></label>
        <label>Venue<select value={venue} onChange={e=>{setVenue(e.target.value);setPage(0);}}><option value="">Semua venue</option>
          {[...new Set(report.findings.map(f=>f.venue))].sort().map(name=><option key={name}>{name}</option>)}</select></label>
        <button type="button" className="btn btn--sm" onClick={()=>download(report)}>Unduh semua hasil (CSV)</button>
      </div>
      <p className="muted small" aria-live="polite">{number.format(filtered.length)} temuan sesuai filter.</p>
      {filtered.length===0 ? <p>{report.findings.length?'Tidak ada temuan sesuai filter.':'Tidak ditemukan masalah dengan aturan audit saat ini.'}</p>
        : <ol className="school-audit-findings" start={page*pageSize+1}>
          {filtered.slice(page*pageSize,(page+1)*pageSize).map((f,index)=><li key={`${f.npsn}:${f.type}:${index}`}>
            <strong>{f.school}</strong><div className="muted small">NPSN {f.npsn} · {f.venue}</div>
            <div className="small"><b>{labels[f.type] || f.type}</b></div><p>{f.evidence}</p>
            {report.review_schools?.find(s=>s.npsn===f.npsn)?.expected_imported_at && <button type="button" className="btn btn--sm" disabled={!!editing}
              onClick={()=>setEditing(report.review_schools.find(s=>s.npsn===f.npsn))}>Periksa / koreksi data</button>}
          </li>)}
        </ol>}
      {filtered.length>pageSize && <div className="school-audit-filters">
        <button type="button" className="btn btn--sm" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Sebelumnya</button>
        <span>Halaman {page+1} / {Math.ceil(filtered.length/pageSize)}</span>
        <button type="button" className="btn btn--sm" disabled={(page+1)*pageSize>=filtered.length} onClick={()=>setPage(p=>p+1)}>Berikutnya</button>
      </div>}
    </>}
  </section>;
}
