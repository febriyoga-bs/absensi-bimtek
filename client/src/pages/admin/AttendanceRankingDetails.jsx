import {useEffect,useRef,useState,useId} from 'react';
import {api} from '../../api.js';
import {personName} from '../../lib/personName.js';

export default function AttendanceRankingDetails({selection,onClose}) {
  const dialog=useRef(null),id=useId();
  const [rows,setRows]=useState(null),[error,setError]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
  useEffect(()=>{dialog.current.showModal();},[]);
  useEffect(()=>{let active=true;setRows(null);setError('');
    const params=new URLSearchParams({session_id:selection.sessionId,owner_id:selection.owner.id,metric:selection.metric});
    api(`/admin/reporting/attendance-ranking?${params}`,{admin:true}).then(data=>{if(active)setRows(data);}).catch(cause=>{if(active)setError(cause.message);});
    return ()=>{active=false;};
  },[selection,revision]);
  const term=query.trim().toLocaleLowerCase('id');
  const filtered=(rows || []).filter(row=>[row.name,row.npsn,row.institution,row.position].some(value=>String(value || '').toLocaleLowerCase('id').includes(term)));
  const pages=Math.max(1,Math.ceil(filtered.length/20));
  const statuses={valid:'Valid',review:'Perlu dicek',berhalangan:'Mundur / berhalangan'};
  return <dialog ref={dialog} className="pks-dialog pks-school-list-dialog" aria-labelledby={id} onCancel={onClose}>
    <header><div><h2 id={id}>{selection.label}</h2><p>{personName(selection.owner.name)} · {selection.owner.venue}<span>{selection.sessionName}</span></p></div><button type="button" className="pks-dialog__close" aria-label="Tutup rincian absensi" onClick={onClose}>×</button></header>
    <div className="pks-dialog__body">
      <label className="pks-school-list-search">Cari nama, NPSN, atau sekolah<input type="search" value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}}/></label>
      {error && <p role="alert" className="alert alert--err">{error} <button className="btn" type="button" onClick={()=>setRevision(value=>value+1)}>Coba lagi</button></p>}
      {!rows && !error && <p role="status">Memuat rincian…</p>}
      {rows && <><p className="pks-form-hint">{filtered.length} orang{term?' sesuai pencarian':''} · Data dihitung per orang.</p>
        {!filtered.length && <p role="status">{rows.length?'Tidak ada hasil yang cocok.':'Belum ada orang dalam kategori ini pada cakupan yang dipilih.'}</p>}
        <ul className="pks-metric-school-list">{filtered.slice((page-1)*20,page*20).map(row=><li key={row.id}><h3>{personName(row.name)}</h3><p>{row.position} · {row.institution || 'Instansi belum terdata'}</p>{row.npsn && <p>NPSN {row.npsn}</p>}<p>{row.venue}</p><p>Kehadiran di venue: {row.present?'Tercatat hadir':'Belum tercatat hadir'}</p><p>Pencatatan LO pada sesi ini: {statuses[row.status] || 'Belum dicatat'}</p>{row.created_at && <p>{new Date(row.created_at).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})} WIB</p>}{row.participant_note && <p>Catatan: {row.participant_note}</p>}</li>)}</ul>
        {pages>1 && <nav className="pks-school-list-pages" aria-label="Halaman rincian absensi"><button type="button" className="btn" disabled={page===1} onClick={()=>setPage(value=>value-1)}>Sebelumnya</button><span>{page} / {pages}</span><button type="button" className="btn" disabled={page===pages} onClick={()=>setPage(value=>value+1)}>Berikutnya</button></nav>}
      </>}
    </div><footer><button className="btn btn--primary" type="button" onClick={onClose}>Tutup</button></footer>
  </dialog>;
}
