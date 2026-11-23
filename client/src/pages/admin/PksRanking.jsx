import { useState } from 'react';
import { rankPksOwners } from '../../lib/pksRanking.js';
import { personName } from '../../lib/personName.js';
import AttendanceRanking from './AttendanceRanking.jsx';
import {summarizeBimtek} from '../../../../shared/pksBimtek.js';
import PksMetricInfo from './PksMetricInfo.jsx';

const percent = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

export default function PksRanking({ data, venue, query, owner, onReload }) {
  const [tab, setTab] = useState('progress');
  const rows = rankPksOwners(data.schools, data.lo, venue)
    .filter(row => (!owner || row.name === owner) && personName(row.name).toLocaleLowerCase('id').includes(query));
  return <section className="pks-ranking" aria-label="Peringkat LO">
    <header className="pks-ranking__heading"><h2>Peringkat LO</h2>{tab === 'progress' && <button type="button" className="btn btn--sm" onClick={onReload}>Muat ulang</button>}</header>
    <div className="pks-tabs" role="group" aria-label="Jenis peringkat LO">
      <button aria-pressed={tab === 'progress'} onClick={() => setTab('progress')}>Kelengkapan PKS</button>
      <button aria-pressed={tab === 'bimtek'} onClick={() => setTab('bimtek')}>Pendampingan Bimtek</button>
      <button aria-pressed={tab === 'attendance'} onClick={() => setTab('attendance')}>Absensi</button>
    </div>
    {tab === 'attendance' ? <AttendanceRanking venue={venue} query={query} owner={owner} facilitatorLabel="verifikator" compact /> : tab === 'bimtek' ? <>
      <p className="pks-ranking__note">Progres pemeriksaan verifikator dikelompokkan menurut pendampingan LO dan dihitung berdasarkan NPSN unik. Verifikator memeriksa, mengisi checklist, dan menindaklanjuti hasilnya; LO membantu serta mengingatkan verifikator. Urutan mengikuti persentase PKS lengkap.</p>
      <div className="pks-bimtek-owners">{rows.map(row=>{
        const counts=summarizeBimtek(data.schools.filter(s=>s.venue===row.venue && s.lo===row.name));
        return <article key={`${row.venue}:${row.name}`}><h3>{personName(row.name)}</h3><p>{row.venue} · {counts.total} sekolah binaan</p><dl>{[['documents','Dokumen siap'],['submitted','RAB diajukan'],['reviewed','RAB sesuai'],['followup','Perlu tindak lanjut'],['complete','PKS lengkap']].map(([key,label])=><PksMetricInfo key={key} metric={key} label={label} context={`${personName(row.name)} · ${row.venue}`}>{counts[key]} / {counts.total}<small>{counts.total ? ` (${Math.round(counts[key]*100/counts.total)}%)` : ' (Belum ada binaan)'}</small></PksMetricInfo>)}</dl></article>;
      })}{!rows.length && <p>Tidak ada LO yang cocok dengan filter.</p>}</div>
    </> : <>
      <p className="pks-ranking__note">Diurutkan berdasarkan persentase sekolah berstatus Lengkap.</p>
      <div className="reporting-ranking" tabIndex={0} aria-label="Peringkat capaian verifikasi sekolah">
        {rows.length ? <ol>{rows.map(row => <li key={`${row.venue}:${row.name}`}>
          <div className="reporting-ranking-name"><b>{row.rank ?? '—'}. {personName(row.name)}</b><strong>{row.ratio == null ? 'Belum ada binaan' : `${percent.format(row.ratio)}%`}</strong></div>
          <progress max={100} value={row.ratio ?? 0} aria-label={`${personName(row.name)}: ${row.completed} dari ${row.total} sekolah lengkap`} />
          <p>{row.completed}/{row.total} sekolah memiliki PKS lengkap · {row.venue}</p>
        </li>)}</ol> : <p>Tidak ada LO yang cocok dengan filter.</p>}
      </div>
    </>}
  </section>;
}
