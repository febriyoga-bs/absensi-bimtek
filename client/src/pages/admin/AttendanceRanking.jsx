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
    .map((row, i) => ({ ...row, rank: i + 1 }))
    .filter((row) => row.name.toLowerCase().includes(query));
  return <section aria-label="Peringkat absensi LO">
    <div className="toolbar">
      <label>Tanggal sesi (WIB)<input type="date" value={day} onChange={(event) => setDay(event.target.value)} /></label>
      <button type="button" className="btn btn--sm" onClick={() => setDay('')}>Semua tanggal</button>
      <button type="button" className="btn btn--sm" onClick={() => setRevision((value) => value + 1)}>Muat ulang</button>
    </div>
    <p className="muted small">Peringkat berdasarkan jumlah orang unik yang diabsenkan LO: Bendahara, Pengawas, dan Fasilitator. Orang yang sama dihitung sekali meskipun absen di beberapa sesi. Hanya sesi resmi dengan status Valid atau Perlu dicek; absensi mandiri, ditolak, dan berhalangan tidak dihitung.</p>
    {error && <p className="alert alert--err" role="alert">{error}</p>}
    {!result && !error && <p role="status">Memuat peringkat absensi…</p>}
    {result && <div className="assignment-table"><table className="table stack-table" aria-label="Peringkat LO berdasarkan absensi">
      <thead><tr>{['Peringkat', 'LO', 'Venue', 'Peserta', 'Fasilitator', 'Total'].map((label) => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}>
        <td>{row.rank}</td><td data-label="LO"><b>{row.name}</b></td><td data-label="Venue">{row.venue}</td>
        <td data-label="Peserta">{row.participants}</td><td data-label="Fasilitator">{row.facilitators}</td><td data-label="Total"><b>{row.total}</b></td>
      </tr>)}{!rows.length && <tr><td colSpan={6}>Tidak ada LO yang cocok dengan filter.</td></tr>}</tbody>
    </table></div>}
  </section>;
}
