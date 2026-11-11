import { useEffect, useState } from 'react';
import { api } from '../../api.js';

export default function AttendanceRanking({ venue, query }) {
  const [day, setDay] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setResult(null); setError('');
    api(`/admin/reporting/attendance-ranking${day ? `?day=${encodeURIComponent(day)}` : ''}`, { admin: true })
      .then((rows) => { if (current) setResult(rows); })
      .catch((err) => { if (current) setError(err.message); });
    return () => { current = false; };
  }, [day, revision]);
  const rows = (result || []).filter((row) => !venue || row.venue === venue)
    .map((row) => ({ ...row, ratio: row.assigned ? row.total * 100 / row.assigned : null }))
    .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.total - a.total || a.name.localeCompare(b.name, 'id'))
    .map((row, i) => ({ ...row, rank: i + 1 }))
    .filter((row) => row.name.toLowerCase().includes(query));
  return <section aria-label="Peringkat absensi LO">
    <div className="toolbar">
      <label>Tanggal sesi (WIB)<input type="date" value={day} onChange={(event) => setDay(event.target.value)} /></label>
      <button type="button" className="btn btn--sm" onClick={() => setDay('')}>Semua tanggal</button>
      <button type="button" className="btn btn--sm" onClick={() => setRevision((value) => value + 1)}>Muat ulang</button>
    </div>
    <p className="muted small">Persentase = binaan yang diabsenkan LO ÷ total profil binaan Bendahara, Pengawas, dan Fasilitator. Orang yang sama dihitung sekali pada tanggal sesi yang dipilih. Hanya sesi resmi dengan status Valid atau Perlu dicek; absensi mandiri, ditolak, dan berhalangan tidak dihitung.</p>
    {error && <p className="alert alert--err" role="alert">{error}</p>}
    {!result && !error && <p role="status">Memuat peringkat absensi…</p>}
    {result && <div className="reporting-ranking" tabIndex={0}>
      {rows.length ? <ol>{rows.map((row) => <li key={row.id}>
        <div className="reporting-ranking-name"><b>{row.rank}. {row.name}</b>
          <strong>{row.ratio == null ? 'Belum ada binaan' : `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(row.ratio)}%`}</strong></div>
        <progress aria-label={`Capaian absensi ${row.name}`} value={row.ratio ?? 0} max={100} />
        <p>Total {row.total}/{row.assigned} binaan sudah diabsenkan · {row.participants} peserta · {row.facilitators} fasilitator · {row.venue}</p>
      </li>)}</ol> : <p className="muted">Tidak ada LO yang cocok dengan filter.</p>}
    </div>}
  </section>;
}
