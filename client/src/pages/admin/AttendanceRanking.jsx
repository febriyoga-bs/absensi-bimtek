import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { sessionTitle } from './shared.js';

export default function AttendanceRanking({ venue, query }) {
  const [sessionId, setSessionId] = useState('');
  const [sessions, setSessions] = useState([]);
  const [sessionError, setSessionError] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    api('/admin/sessions', { admin: true })
      .then((data) => { if (current) { setSessions(data.filter((s) => !s.is_test)); setSessionError(''); } })
      .catch((err) => { if (current) setSessionError(err.message); });
    return () => { current = false; };
  }, [revision]);
  useEffect(() => {
    let current = true;
    setResult(null); setError('');
    api(`/admin/reporting/attendance-ranking${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''}`, { admin: true })
      .then((rows) => { if (current) setResult(rows); })
      .catch((err) => { if (current) setError(err.message); });
    return () => { current = false; };
  }, [sessionId, revision]);
  const rows = (result || []).filter((row) => !venue || row.venue === venue)
    .map((row) => ({ ...row, ratio: row.assigned ? row.total * 100 / row.assigned : null }))
    .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.total - a.total || a.name.localeCompare(b.name, 'id'))
    .map((row, i) => ({ ...row, rank: i + 1 }))
    .filter((row) => row.name.toLowerCase().includes(query));
  return <section aria-label="Peringkat absensi LO">
    <div className="toolbar">
      <label>Sesi<select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
        <option value="">Semua sesi resmi</option>
        {sessions.map((session) => <option key={session.id} value={session.id}>{sessionTitle(session)} ({session.role})</option>)}
      </select></label>
      <button type="button" className="btn btn--sm" onClick={() => setRevision((value) => value + 1)}>Muat ulang</button>
    </div>
    {sessionError && <p className="alert alert--err" role="alert">Daftar sesi gagal dimuat. {sessionError}</p>}
    <p className="muted small">Persentase = binaan yang diabsenkan LO ÷ total profil binaan Bendahara, Pengawas, dan Fasilitator. Orang yang sama dihitung sekali dalam sesi yang dipilih, atau sekali lintas sesi pada pilihan Semua sesi resmi. Hanya sesi resmi dengan status Valid atau Perlu dicek; absensi mandiri, ditolak, dan berhalangan tidak dihitung.</p>
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
