import { useState } from 'react';
import { rankPksOwners } from '../../lib/pksRanking.js';
import { personName } from '../../lib/personName.js';
import AttendanceRanking from './AttendanceRanking.jsx';

const percent = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

export default function PksRanking({ data, venue, query, owner, onReload }) {
  const [tab, setTab] = useState('progress');
  const rows = rankPksOwners(data.schools, data.lo, venue)
    .filter(row => (!owner || row.name === owner) && personName(row.name).toLocaleLowerCase('id').includes(query));
  return <section className="pks-ranking" aria-label="Peringkat LO">
    <header className="pks-ranking__heading"><h2>Peringkat LO</h2>{tab === 'progress' && <button type="button" className="btn btn--sm" onClick={onReload}>Muat ulang</button>}</header>
    <div className="pks-tabs" role="group" aria-label="Jenis peringkat LO">
      <button aria-pressed={tab === 'progress'} onClick={() => setTab('progress')}>Capaian Verifikasi Sekolah</button>
      <button aria-pressed={tab === 'attendance'} onClick={() => setTab('attendance')}>Absensi</button>
    </div>
    {tab === 'attendance' ? <AttendanceRanking venue={venue} query={query} owner={owner} facilitatorLabel="verifikator" compact /> : <>
      <p className="pks-ranking__note">Diurutkan berdasarkan persentase sekolah berstatus Lengkap.</p>
      <div className="reporting-ranking" tabIndex={0} aria-label="Peringkat capaian verifikasi sekolah">
        {rows.length ? <ol>{rows.map(row => <li key={`${row.venue}:${row.name}`}>
          <div className="reporting-ranking-name"><b>{row.rank ?? '—'}. {personName(row.name)}</b><strong>{row.ratio == null ? 'Belum ada binaan' : `${percent.format(row.ratio)}%`}</strong></div>
          <progress max={100} value={row.ratio ?? 0} aria-label={`${personName(row.name)}: ${row.completed} dari ${row.total} sekolah lengkap`} />
          <p>{row.completed}/{row.total} sekolah sudah diverifikasi lengkap · {row.venue}</p>
        </li>)}</ol> : <p>Tidak ada LO yang cocok dengan filter.</p>}
      </div>
    </>}
  </section>;
}
