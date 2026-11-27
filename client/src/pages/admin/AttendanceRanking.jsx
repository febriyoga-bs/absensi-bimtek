import LoRepresentation from '../../components/LoRepresentation.jsx';
import { personName } from '../../lib/personName.js';
import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { sessionTitle } from './shared.js';
import AttendanceRankingDetails from './AttendanceRankingDetails.jsx';

export default function AttendanceRanking({ venue, query, owner = '', facilitatorLabel = 'fasilitator', compact = false }) {
  const [sessionId, setSessionId] = useState('');
  const [targetBasis, setTargetBasis] = useState('assigned');
  const [sessions, setSessions] = useState([]);
  const [sessionError, setSessionError] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selection,setSelection]=useState(null);
  const detailButton=(row,metric,label,value)=><button type="button" className="pks-count-button" aria-haspopup="dialog" aria-label={`Lihat ${label}: ${value} orang — ${personName(row.name)}`} onClick={()=>setSelection({owner:row,metric,label,sessionId,sessionName:sessionTitle(sessions.find(s=>String(s.id)===sessionId) || {})})}>{value}</button>;
  useEffect(() => {
    let current = true;
    api('/admin/sessions?official=1&summary=0', { admin: true })
      .then((data) => { if (current) {
        const official = data.filter((s) => !s.is_test && s.role !== 'panitia');
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
    .map((row) => {
      const completed = row.total + row.unavailable;
      const target = targetBasis === 'assigned' ? row.assigned : row.present;
      return { ...row, completed, target, ratio: target ? completed * 100 / target : null };
    })
    .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.total - a.total || a.name.localeCompare(b.name, 'id'))
    .map((row, i) => ({ ...row, rank: i + 1 }))
    .filter((row) => (!owner || row.name === owner) && row.name.toLowerCase().includes(query));
  return <section className={compact ? 'pks-attendance-ranking' : undefined} aria-label="Peringkat absensi LO">
    <div className="toolbar">
      <label>Sesi<select value={sessionId} disabled={!sessions.length} onChange={(event) => setSessionId(event.target.value)}>
        {!sessionId && <option value="">{sessionError ? 'Daftar sesi gagal dimuat' : 'Memuat sesi resmi…'}</option>}
        {sessions.map((session) => <option key={session.id} value={session.id}>{sessionTitle(session)} ({session.role})</option>)}
      </select></label>
      <label>Target<select value={targetBasis} onChange={(event) => { setTargetBasis(event.target.value); setSelection(null); }}>
        <option value="assigned">Berdasarkan binaan</option>
        <option value="present">Berdasarkan hadir di venue</option>
      </select></label>
      <button type="button" className="btn btn--sm" onClick={() => setRevision((value) => value + 1)}>Muat ulang</button>
    </div>
    {sessionError && <p className="alert alert--err" role="alert">Daftar sesi gagal dimuat. {sessionError}</p>}
    {!sessionId && !sessionError && sessions.length === 0 && <p className="muted">Menunggu daftar sesi resmi. Klik Muat ulang jika belum tersedia.</p>}
    {compact ? <div className="pks-attendance-help"><p>Absensi dihitung per orang, bukan per sekolah.</p><details><summary>Cara hitung</summary><p>Progres mencakup absensi dan catatan mundur/berhalangan oleh LO pada sesi pilihan. Target mengikuti pilihan filter: seluruh binaan atau binaan yang tercatat hadir di venue pada sesi pilihan. Kehadiran aktual mengikuti absensi resmi sesi pilihan, tanpa rekap kedatangan. Sesi panitia tidak ditampilkan pada peringkat pencatatan binaan peserta/verifikator. Absensi mandiri dan ditolak tidak dihitung sebagai pekerjaan LO.</p></details></div> : <p className="muted small">Progres mencakup binaan yang diabsenkan dan yang dicatat Mundur/Berhalangan Hadir oleh LO pada sesi pilihan. Target mengikuti pilihan filter: seluruh binaan atau binaan yang tercatat hadir di venue pada sesi pilihan. Kehadiran aktual berdasarkan absensi resmi sesi pilihan, tanpa rekap kedatangan. Absensi mandiri dan status ditolak tidak dihitung sebagai pekerjaan LO.</p>}
    {error && <p className="alert alert--err" role="alert">{error}</p>}
    {sessionId && !result && !error && <p role="status">Memuat peringkat absensi…</p>}
    {result && <div className="reporting-ranking" tabIndex={0}>
      {rows.length ? <ol>{rows.map((row) => <li key={row.id}>
        <div className="reporting-ranking-name"><b>{row.rank}. {personName(row.name)}<LoRepresentation name={row.name}/></b>
          <strong>{compact ? (row.ratio == null ? (targetBasis === 'assigned' ? 'Belum ada binaan' : 'Belum ada binaan tercatat hadir di venue') : `${row.completed}/${row.target} · ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(row.ratio)}%`) : <>{row.completed}/{row.target} sudah dicatat{row.ratio == null ? '' : ` (${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(row.ratio)}%)`}</>}</strong></div>
        <progress aria-label={`${row.completed} dari ${row.target} sudah dicatat oleh ${personName(row.name)}`} value={row.ratio ?? 0} max={100} />
        {compact ? <>
          <details className="pks-attendance-breakdown">
          <summary><span className="pks-attendance-venue">{row.venue}</span><span className="pks-attendance-detail-label">Rincian absensi</span></summary>
          <dl className="pks-attendance-metrics">
            <div><dt>Binaan</dt><dd>{detailButton(row,'assigned','Binaan',row.assigned)}<small>orang</small></dd></div>
            <div><dt>Hadir di venue</dt><dd>{detailButton(row,'present','Hadir di venue',row.present)}<small>orang</small></dd></div>
            <div><dt>Sudah dicatat</dt><dd>{detailButton(row,'completed','Sudah dicatat',row.completed)}<small>dari {detailButton(row,targetBasis === 'assigned' ? 'assigned' : 'target','Target pencatatan',row.target)} target</small></dd></div>
            <div><dt>Berhalangan</dt><dd>{detailButton(row,'unavailable','Berhalangan',row.unavailable)}<small>orang</small></dd></div>
          </dl>
          <p>{detailButton(row,'participants','Peserta sudah diabsenkan',row.participants)} peserta dan {detailButton(row,'facilitators',`${facilitatorLabel} sudah diabsenkan`,row.facilitators)} {facilitatorLabel} sudah diabsenkan. {detailButton(row,'unavailable','Berhalangan',row.unavailable)} orang dicatat mundur/berhalangan.</p></details>
        </> : <p>{row.present}/{row.assigned} peserta/{facilitatorLabel} hadir di venue · {row.participants} peserta dan {row.facilitators} {facilitatorLabel} sudah diabsenkan · {row.unavailable} mundur/berhalangan hadir · {row.venue}</p>}
      </li>)}</ol> : <p className="muted">Tidak ada LO yang cocok dengan filter.</p>}
    </div>}
    {selection && <AttendanceRankingDetails selection={selection} onClose={()=>setSelection(null)}/>}
  </section>;
}
