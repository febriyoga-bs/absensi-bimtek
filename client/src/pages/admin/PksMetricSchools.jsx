import {useEffect,useRef,useState,useId} from 'react';
import {schoolsForBimtekMetric} from '../../../../shared/pksBimtek.js';
import {schoolInspectionItems} from '../../lib/pksInspection.js';
import {personName} from '../../lib/personName.js';

export default function PksMetricSchools({selection,onClose}) {
  const dialog=useRef(null),id=useId();
  const [query,setQuery]=useState(''),[page,setPage]=useState(1);
  useEffect(()=>{dialog.current.showModal();},[]);
  const schools=schoolsForBimtekMetric(selection.schools,selection.metric);
  const term=query.trim().toLocaleLowerCase('id');
  const filtered=schools.filter(s=>[s.npsn,s.name,s.facilitator,s.coordinator].some(value=>String(value || '').toLocaleLowerCase('id').includes(term)));
  const pages=Math.max(1,Math.ceil(filtered.length/20));
  return <dialog ref={dialog} className="pks-dialog pks-school-list-dialog" aria-labelledby={id} onCancel={onClose}>
    <header><div><h2 id={id}>{selection.label}</h2><p>{selection.context}<span>{schools.length.toLocaleString('id-ID')} sekolah</span></p></div><button className="pks-dialog__close" type="button" aria-label="Tutup daftar sekolah" onClick={onClose}>×</button></header>
    <div className="pks-dialog__body"><label className="pks-school-list-search">Cari sekolah, NPSN, atau verifikator<input type="search" value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}} placeholder="Nama sekolah atau NPSN"/></label>
      {!filtered.length ? <p role="status" className="pks-empty">{schools.length?'Tidak ada sekolah yang cocok dengan pencarian.':'Belum ada sekolah yang tercatat memenuhi indikator ini.'}</p> : <>
        <p className="pks-form-hint">{filtered.length} sekolah{term?' sesuai pencarian':''}</p>
        <ul className="pks-metric-school-list">{filtered.slice((page-1)*20,page*20).map(school=><li key={school.npsn}><h3>{personName(school.name)}</h3><p>NPSN {school.npsn} · {school.venue}</p><p>Verifikator: {personName(school.facilitator) || 'Belum terdata'}</p><dl>{schoolInspectionItems(school).filter(item=>selection.metric==='total' || item.metric===selection.metric).map(item=><div key={item.metric}><dt>{item.label}</dt><dd>{item.status}</dd></div>)}</dl>{(school.bimtek?.note || school.pks?.catatan) && <p>Catatan: {[school.bimtek?.note,school.pks?.catatan].filter(Boolean).join(' · ')}</p>}</li>)}</ul>
        {pages>1 && <nav className="pks-school-list-pages" aria-label="Halaman daftar sekolah"><button type="button" className="btn" disabled={page===1} onClick={()=>setPage(value=>value-1)}>Sebelumnya</button><span>{page} / {pages}</span><button type="button" className="btn" disabled={page===pages} onClick={()=>setPage(value=>value+1)}>Berikutnya</button></nav>}
      </>}
    </div><footer><button type="button" className="btn btn--primary" onClick={onClose}>Tutup</button></footer>
  </dialog>;
}
