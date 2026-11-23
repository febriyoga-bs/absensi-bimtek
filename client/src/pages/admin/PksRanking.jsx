import LoRepresentation from '../../components/LoRepresentation.jsx';
import { useState } from 'react';
import { rankPksOwners } from '../../lib/pksRanking.js';
import { personName } from '../../lib/personName.js';
import AttendanceRanking from './AttendanceRanking.jsx';
import {summarizeBimtek} from '../../../../shared/pksBimtek.js';
import PksMetricInfo from './PksMetricInfo.jsx';
import PksMetricSchools from './PksMetricSchools.jsx';
import {rankBimtekOwners} from '../../lib/pksBimtekRanking.js';

const percent = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

export default function PksRanking({ data, venue, query, owner, onReload }) {
  const [tab, setTab] = useState('progress');
  const [schoolList,setSchoolList]=useState(null);
  const rows = rankPksOwners(data.schools, data.lo, venue)
    .filter(row => (!owner || row.name === owner) && personName(row.name).toLocaleLowerCase('id').includes(query));
  const bimtekRows=rankBimtekOwners(data.schools,data.lo,venue).filter(row=>(!owner || row.name===owner) && personName(row.name).toLocaleLowerCase('id').includes(query));
  return <section className="pks-ranking" aria-label="Peringkat LO">
    <header className="pks-ranking__heading"><h2>Peringkat LO</h2>{tab === 'progress' && <button type="button" className="btn btn--sm" onClick={onReload}>Muat ulang</button>}</header>
    <div className="pks-tabs" role="group" aria-label="Jenis peringkat LO">
      <button aria-pressed={tab === 'progress'} onClick={() => setTab('progress')}>Kelengkapan PKS</button>
      <button aria-pressed={tab === 'bimtek'} onClick={() => setTab('bimtek')}>Pendampingan Bimtek</button>
      <button aria-pressed={tab === 'attendance'} onClick={() => setTab('attendance')}>Absensi</button>
    </div>
    {tab === 'attendance' ? <AttendanceRanking venue={venue} query={query} owner={owner} facilitatorLabel="verifikator" compact /> : tab === 'bimtek' ? <>
      <details className="pks-overall-help"><summary>Cara hitung overall</summary><p>Overall adalah rata-rata persentase dokumen lengkap, RAB diajukan, RAB sesuai, dan PKS lengkap, masing-masing berbobot 25%. Perlu tindak lanjut tidak menambah skor. Nilai sama mendapat peringkat sama.</p></details><div className="pks-bimtek-owners">{bimtekRows.map(row=>{
        const schools=data.schools.filter(s=>s.venue===row.venue && s.lo===row.name);
        const counts=summarizeBimtek(schools),context=`${personName(row.name)} · ${row.venue}`;
        const show=(metric,label)=>setSchoolList({metric,label,context,schools});
        return <article key={`${row.venue}:${row.name}`}><div className="pks-overall-heading"><h3><span className="pks-rank-badge">#{row.rank ?? '—'}</span>{personName(row.name)}<LoRepresentation name={row.name}/></h3><strong>{row.overall==null?'—':`${percent.format(row.overall)}%`}<small>Overall</small></strong></div><progress className="pks-overall-bar" max={100} value={row.overall ?? 0} aria-label={`Overall ${personName(row.name)}`} /><p>{row.venue} · <button className="pks-count-button" type="button" aria-haspopup="dialog" onClick={()=>show('total','Seluruh sekolah binaan')}>{counts.total} sekolah binaan</button></p><dl>{[['documents','Dokumen siap'],['submitted','RAB diajukan'],['reviewed','RAB sesuai'],['followup','Perlu tindak lanjut'],['complete','PKS lengkap']].map(([key,label])=><PksMetricInfo key={key} metric={key} label={label} context={context}><button className="pks-count-button" type="button" aria-haspopup="dialog" aria-label={`Lihat ${counts[key]} sekolah: ${label} — ${personName(row.name)}`} onClick={()=>show(key,label)}>{counts[key]}</button> / <button className="pks-count-button" type="button" aria-haspopup="dialog" aria-label={`Lihat seluruh ${counts.total} sekolah binaan ${personName(row.name)}`} onClick={()=>show('total','Seluruh sekolah binaan')}>{counts.total}</button><small>{counts.total ? ` (${Math.round(counts[key]*100/counts.total)}%)` : ' (Belum ada binaan)'}</small></PksMetricInfo>)}</dl></article>;
      })}{!bimtekRows.length && <p>Tidak ada LO yang cocok dengan filter.</p>}</div>
    </> : <>
      <p className="pks-ranking__note">Diurutkan berdasarkan persentase sekolah berstatus Lengkap.</p>
      <div className="reporting-ranking" tabIndex={0} aria-label="Peringkat capaian verifikasi sekolah">
        {rows.length ? <ol>{rows.map(row => <li key={`${row.venue}:${row.name}`}>
          <div className="reporting-ranking-name"><b>{row.rank ?? '—'}. {personName(row.name)}<LoRepresentation name={row.name}/></b><strong>{row.ratio == null ? 'Belum ada binaan' : `${percent.format(row.ratio)}%`}</strong></div>
          <progress max={100} value={row.ratio ?? 0} aria-label={`${personName(row.name)}: ${row.completed} dari ${row.total} sekolah lengkap`} />
          <p>{row.completed}/{row.total} sekolah memiliki PKS lengkap · {row.venue}</p>
        </li>)}</ol> : <p>Tidak ada LO yang cocok dengan filter.</p>}
      </div>
    </>}
    {schoolList && <PksMetricSchools selection={schoolList} onClose={()=>setSchoolList(null)}/>}
  </section>;
}
