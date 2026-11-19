import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { personName } from '../../lib/personName.js';
import { fmtDT, sessionTitle, attendanceReasonText } from './shared.js';

const number = new Intl.NumberFormat('id-ID');
const PAGE = 50;

export default function SessionStatusDialog({ selection, onClose }) {
  const dialog = useRef(null);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => { if (element.open) element.close(); };
  }, []);
  useEffect(() => {
    let active = true;
    setResult(null); setError('');
    const params = new URLSearchParams({ status: selection.status, limit: String(PAGE), offset: String(page * PAGE),
      ...(selection.venueId && { venue_id: selection.venueId }) });
    api(`/admin/sessions/${selection.session.id}/status-details?${params}`, { admin: true })
      .then((data) => { if (active) setResult(data); })
      .catch((cause) => { if (active) setError(cause.message || 'Rincian gagal dimuat.'); });
    return () => { active = false; };
  }, [selection, page, revision]);
  return <dialog ref={dialog} className="assignment-dialog" aria-labelledby="session-status-title" onCancel={onClose}>
    <header><div><h3 id="session-status-title">{selection.label}</h3>
      <p className="muted small">{sessionTitle(selection.session)} · {selection.venueName || 'Semua venue'}</p>
      {result && <span className="assignment-detail-count">{number.format(result.total)} catatan</span>}</div>
      <button type="button" className="btn btn--sm" onClick={onClose}>Tutup</button></header>
    {error ? <div role="alert"><p className="alert alert--err">{error}</p><button className="btn" onClick={() => setRevision((value) => value + 1)}>Coba lagi</button></div>
      : !result ? <p role="status">Memuat rincian…</p> : <>
        {!result.rows.length && <p className="muted">Tidak ada catatan {selection.label.toLowerCase()} pada cakupan ini.</p>}
        <ol start={page * PAGE + 1}>{result.rows.map((row) => <li key={row.id}>
          <b>{personName(row.representative?.name || row.name || 'Peserta belum diketahui')}</b>
          {row.representative?.name && <div className="muted small"><span className="tag tag--venue">Mewakili</span> {personName(row.name)}</div>}
          <div className="muted small">{[row.code, row.position, row.institution].filter(Boolean).join(' · ')}</div>
          <div className="muted small">{row.venue_name} · {fmtDT(row.created_at)} WIB</div>
          {row.scanned_by && <div className="small">Dicatat oleh {personName(row.scanned_by)}</div>}
          {row.participant_note && <p className="small">Catatan: {row.participant_note}</p>}
          {attendanceReasonText(row.reasons || row.flags) && <p className="small">{attendanceReasonText(row.reasons || row.flags)}</p>}
        </li>)}</ol>
        {result.total > PAGE && <div className="row">
          <button className="btn btn--sm" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Sebelumnya</button>
          <span className="small">Halaman {page + 1} / {Math.ceil(result.total / PAGE)}</span>
          <button className="btn btn--sm" disabled={(page + 1) * PAGE >= result.total} onClick={() => setPage((value) => value + 1)}>Berikutnya</button>
        </div>}
      </>}
  </dialog>;
}
