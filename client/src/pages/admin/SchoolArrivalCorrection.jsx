import {useState} from 'react';
import {api} from '../../api.js';
const roles=['Kepala Sekolah','Bendahara'];
const states={selesai:'Sudah tiba / selesai',sudah_tiba:'Sudah tiba',sedang_antre:'Sedang antre',belum_tiba:'Belum tiba',belum_tercatat:'Belum dikonfirmasi'};
export default function SchoolArrivalCorrection({school,onSaved,onCancel}) {
  const [people,setPeople]=useState(()=>roles.map(role=>{
    const profile=school.profiles.find(p=>p.position===role);
    return {role,name:profile?.name || (role==='Kepala Sekolah'?school.head_name:`Bendahara — ${school.name}`),status:profile?.arrival_status || 'belum_tercatat'};
  }));
  const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  function change(index,field,value) {setPeople(rows=>rows.map((p,i)=>i===index?{...p,[field]:value}:p));}
  async function save(event) {
    event.preventDefault();setBusy(true);setError('');
    try {
      await api('/admin/school-identity-correction',{admin:true,method:'POST',body:{npsn:school.npsn,venue:school.venue,
        expected_imported_at:school.expected_imported_at,attendees:people,reason,confirmed:true}});
      setSaved(true);await onSaved();
    } catch(e) {setError(e.message);}
    finally {setBusy(false);}
  }
  return <form className="form school-arrival-correction" onSubmit={save}>
    <h3>Koreksi {school.name}</h3><p>NPSN <b>{school.npsn}</b> · {school.venue}</p>
    <p className="muted small">Profil saat ini:</p>
    <ul>{school.profiles.map(p=><li key={p.id}>{p.position}: {p.name}
      {p.effective_name!==p.name && <> → tertaut sebagai {p.effective_name}</>} — {states[p.arrival_status] || p.arrival_status}</li>)}</ul>
    <p className="muted small">Nama pada sumber untuk sekolah bernama sama di venue ini:</p>
    <ul>{school.source_rows.map((p,i)=><li key={i}>{p.name} — {p.institution}: {states[p.status] || p.status}</li>)}</ul>
    <p className="muted small">Pastikan pasangan nama sesuai NPSN ini. Koreksi memperbarui profil dan kedatangan, tanpa memindahkan foto atau absensi sesi.</p>
    {people.map((person,index)=><fieldset key={person.role} disabled={busy || saved}>
      <legend>{person.role}</legend>
      <label>Nama<input required maxLength={400} list={`source-names-${school.npsn}`} value={person.name} onChange={e=>change(index,'name',e.target.value)} /></label>
      <label>Status kedatangan<select value={person.status} onChange={e=>change(index,'status',e.target.value)}>
        {Object.entries(states).map(([key,label])=><option key={key} value={key}>{label}</option>)}
      </select></label>
    </fieldset>)}
    <datalist id={`source-names-${school.npsn}`}>{[...new Set(school.source_rows.map(p=>p.name))].map(name=><option key={name} value={name}/>)}</datalist>
    <label>Alasan koreksi<textarea required maxLength={1000} disabled={busy || saved} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Contoh: pasangan kepala sekolah dan bendahara telah dikonfirmasi berdasarkan NPSN." /></label>
    {error && <p role="alert" className="alert alert--err">{error}</p>}
    {saved && <p role="status" className="alert alert--ok">Koreksi tersimpan. Jalankan audit ulang jika daftar belum diperbarui.</p>}
    <div className="school-audit-filters">
      <button type="submit" className="btn btn--primary" disabled={busy || saved || !reason.trim()}>{busy?'Menyimpan…':'Simpan koreksi data'}</button>
      <button type="button" className="btn btn--sm" disabled={busy} onClick={onCancel}>{saved?'Tutup koreksi':'Batal'}</button>
    </div>
  </form>;
}
