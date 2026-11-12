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
      .then((data) => { if (current) {
        const official = data.filter((s) => !s.is_test);
        const ordered = [...official].sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at) || b.id - a.id);
        const preferred = ordered.find((s) => s.is_open) || ordered[0];
        setSessions(official);
        setSessionId((selected) => official.some((s) => String(s.id) === selected) ? selected : preferred ? String(preferred.id) : '');
        setSessionError('');
      } })
      .catch((err) => { if (current) setSessionError(err.message); });
    return () => { current = false; };
  }, [revision]);
  useEffect(() => {
    if (!sessionId) return;
    let current = true;
    setResult(null); setError('');
    api(`/admin/reporting/attendance-ranking${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''}`, { admin: true })
      .then((rows) => { if (current) setResult(rows); })
      .catch((err) => { if (current) setError(err.message); });
    return () => { current = false; };
  }, [sessionId, revision]);
  const rows = (result || []).filter((row) => !venue || row.venue === venue)
    .map((row) => ({ ...row, ratio: row.present ? row.total * 100 / row.present : null }))
    .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.total - a.total || a.name.localeCompare(b.name, 'id'))
    .map((row, i) => ({ ...row, rank: i + 1 }))
    .filter((row) => row.name.toLowerCase().includes(query));
  return <section aria-label="Peringkat absensi LO">
    <div className="toolbar">
      <label>Sesi<select value={sessionId} disabled={!sessions.length} onChange={(event) => setSessionId(event.target.value)}>
        {!sessionId && <option value="">{sessionError ? 'Daftar sesi gagal dimuat' : 'Memuat sesi resmi…'}</option>}
        {sessions.map((session) => <option key={session.id} value={session.id}>{sessionTitle(session)} ({session.role})</option>)}
      </select></label>
      <button type="button" className="btn btn--sm" onClick={() => setRevision((value) => value + 1)}>Muat ulang</button>
    </div>
    {sessionError && <p className="alert alert--err" role="alert">Daftar sesi gagal dimuat. {sessionError}</p>}
    {!sessionId && !sessionError && sessions.length === 0 && <p className="muted">Menunggu daftar sesi resmi. Klik Muat ulang jika belum tersedia.</p>}
    <p className="muted small">Progres = binaan yang diabsenkan LO pada sesi pilihan ÷ binaan yang hadir di venue. Hadir berdasarkan rekap Sudah tiba/Selesai/Sedang antre atau bukti absensi resmi Valid/Perlu dicek, lintas sesi. Setiap orang dihitung sekali, termasuk Bendahara, Pengawas, dan Fasilitator. Absensi mandiri tidak dihitung sebagai pekerjaan LO; status ditolak dan berhalangan tidak dihitung.</p>
    {error && <p className="alert alert--err" role="alert">{error}</p>}
    {sessionId && !result && !error && <p role="status">Memuat peringkat absensi…</p>}
    {result && <div className="reporting-ranking" tabIndex={0}>
      {rows.length ? <ol>{rows.map((row) => <li key={row.id}>
        <div className="reporting-ranking-name"><b>{row.rank}. {row.name}</b>
          <strong>{row.total}/{row.present} sudah diabsenkan{row.ratio == null ? '' : ` (${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(row.ratio)}%)`}</strong></div>
        <progress aria-label={`${row.total} dari ${row.present} sudah diabsenkan oleh ${row.name}`} value={row.ratio ?? 0} max={100} />
        <p>{row.present}/{row.assigned} peserta/fasilitator hadir di venue · {row.participants} peserta dan {row.facilitators} fasilitator sudah diabsenkan · {row.venue}</p>
      </li>)}</ol> : <p className="muted">Tidak ada LO yang cocok dengan filter.</p>}
    </div>}
  </section>;
}
