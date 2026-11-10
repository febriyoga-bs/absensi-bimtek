import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../api.js';
import { readArrivalWorkbook } from '../../lib/reportingFiles.js';
import { useVisiblePolling } from '../../lib/poll.js';
import { fmtFull } from '../../lib/time.js';
import { SkelCards } from '../../components/Skeleton.jsx';

const number = new Intl.NumberFormat('id-ID');

export default function ArrivalRecap() {
  const { user } = useOutletContext();
  const [rows, setRows] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState(null);

  async function refresh() {
    try {
      setRows(await api('/admin/arrival-recap', { admin: true }));
      setError('');
    } catch (e) { setError(e.message); }
  }
  useVisiblePolling(refresh, 30_000);

  async function save(e) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const data = await readArrivalWorkbook(file);
      const result = await api('/admin/arrival-recap/import', { admin: true, method: 'POST', body: { rows: data } });
      setFeedback({ result });
      await refresh();
    } catch (e) {
      setFeedback({ error: e.message });
    } finally { setBusy(false); }
  }
  return (
    <>
      <div className="page-head">
        <div><h2>Rekap Kehadiran</h2><p className="muted">Kedatangan peserta berdasarkan Excel yang diimpor.</p></div>
        <Link className="btn" to="/admin/scan">Absenkan Peserta</Link>
      </div>
      {user?.role === 'admin' && <details className="card arrival-import">
        <summary>Impor Rekap Kehadiran (.xlsx)</summary>
        <form className="form" onSubmit={save}>
          <p className="muted small">Unggah file Excel yang memuat sheet <b>Detail Peserta</b>. Impor mengganti penanda kedatangan pada venue yang tercantum dalam file.</p>
          <p className="muted small">Status Selesai dan Sudah Tiba ditandai sebagai Sudah hadir. Status Sedang Antri ditampilkan sebagai Sedang antre.</p>
          <input type="file" accept=".xlsx" aria-label="File Excel rekap kehadiran" onChange={(e) => { setFile(e.target.files[0]); setFeedback(null); }} disabled={busy} />
          <button type="submit" className="btn btn--primary" disabled={!file || busy}>{busy ? 'Menyimpan…' : 'Impor kehadiran'}</button>
          {feedback?.error && <p className="alert alert--err" role="alert">{feedback.error}</p>}
          {feedback?.result && <p className="alert alert--ok" role="status">
            {number.format(feedback.result.matched)} peserta ditandai di {feedback.result.venues} venue.
            {' '}{number.format(feedback.result.unmatched)} baris kedatangan belum bisa dicocokkan.
          </p>}
        </form>
      </details>}
      {error && <p className="alert alert--err" role="alert">{error}</p>}
      {!rows && !error && <div className="stats"><SkelCards n={3} h={96} /></div>}
      {rows && <div className="venue-attendance-grid">
        {rows.map((venue) => (
          <article key={venue.id} className="venue-attendance">
            <h3>{venue.name}</h3>
            {venue.imported_at ? <>
              <p><b>{number.format(venue.arrived)}</b> sudah hadir · <b>{number.format(venue.queued)}</b> sedang antre</p>
              <small className="muted">Terakhir diimpor {fmtFull(venue.imported_at)}</small>
            </> : <p className="muted">Belum ada impor kehadiran.</p>}
          </article>
        ))}
      </div>}
    </>
  );
}
