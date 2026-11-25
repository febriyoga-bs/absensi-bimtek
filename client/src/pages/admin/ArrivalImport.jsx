import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { readArrivalWorkbook } from '../../lib/reportingFiles.js';
import { Spinner } from '../../components/Skeleton.jsx';

const number = new Intl.NumberFormat('id-ID');
export default function ArrivalImport({ onImported, onTimestampChange }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [importStage, setImportStage] = useState('');
  const [showImportResult, setShowImportResult] = useState(false);
  const importDialog = useRef(null);
  const [feedback, setFeedback] = useState(null);
  const [importRevision, setImportRevision] = useState(0);

  useEffect(() => {
    let active = true;
    api('/admin/arrival-recap', { admin: true }).then(rows => {
      if (!active) return;
      const dates = rows.map(row => row.imported_at && new Date(row.imported_at))
        .filter(date => date && Number.isFinite(date.getTime()));
      onTimestampChange?.({ status: 'ready', date: dates.length ? new Date(Math.max(...dates.map(date => date.getTime()))) : null });
    }).catch(() => { if (active) onTimestampChange?.({ status: 'error', date: null }); });
    return () => { active = false; };
  }, [importRevision, onTimestampChange]);

  useEffect(() => {
    if ((busy || showImportResult) && !importDialog.current.open) importDialog.current.showModal();
  }, [busy, showImportResult]);

  async function save(e) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setShowImportResult(true);
    setImportStage('Membaca sheet Ringkasan dan Detail Peserta…');
    setFeedback(null);
    try {
      const data = await readArrivalWorkbook(file);
      setImportStage(`Mengirim ${number.format(data.rows.length)} baris, mencocokkan profil, dan menyimpan rekap…`);
      const result = await api('/admin/arrival-recap/import', { admin: true, method: 'POST', body: data });
      setImportRevision(value => value + 1);
      setImportStage('Impor tersimpan. Memperbarui tampilan rekap…');
      const refreshed = await onImported();
      setFeedback({ result, refreshFailed: !refreshed });
    } catch (e) {
      setFeedback({ error: e.message });
    } finally { setBusy(false); }
  }
  return (
    <>
      <dialog ref={importDialog} className="assignment-dialog import-progress-dialog" aria-labelledby="arrival-import-title"
        aria-busy={busy} onCancel={(event) => { if (busy) event.preventDefault(); }}
        onClose={() => setShowImportResult(false)}>
        <header><h3 id="arrival-import-title">{busy ? 'Memproses impor kehadiran' : feedback?.error ? 'Impor belum selesai' : 'Impor selesai'}</h3></header>
        <p className="muted small">{file?.name}</p>
        {busy ? <div className="import-progress-status" role="status"><Spinner size={24} /><div><b>{importStage}</b>
          <p className="muted small">Mohon tunggu dan jangan menutup halaman selama proses berlangsung.</p></div></div>
          : feedback?.error ? <div className="alert alert--err" role="alert">{feedback.error}</div>
          : feedback?.result && <>
            <p className="alert alert--ok" role="status">Rekap kehadiran berhasil disimpan.</p>
            <dl className="import-result-summary">
              <dt>Baris Detail Peserta</dt><dd>{number.format(feedback.result.imported)}</dd>
              <dt>Venue diperbarui</dt><dd>{number.format(feedback.result.venues)}</dd>
              <dt>Profil terhubung (unik)</dt><dd>{number.format(feedback.result.matched)}</dd>
              <dt>Baris kedatangan belum cocok</dt><dd>{number.format(feedback.result.unmatched)}</dd>
              <dt>Nama pengganti terhubung</dt><dd>{number.format(feedback.result.representatives || 0)}</dd>
            </dl>
            <p className="muted small">Profil unik dan baris Excel memiliki satuan berbeda, sehingga jumlahnya tidak selalu sama dengan total baris.</p>
            {!!feedback.result.warnings?.length && <div className="alert alert--warn"><div><b>Peringatan data sumber</b>
              <ul>{feedback.result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div></div>}
            {feedback.refreshFailed && <p className="alert alert--warn">Data sudah tersimpan, tetapi tampilan rekap gagal diperbarui. Muat ulang halaman untuk melihat data terbaru.</p>}
          </>}
        {!busy && <button type="button" className="btn btn--primary" onClick={() => importDialog.current.close()}>Tutup</button>}
      </dialog>
      <details className="card arrival-import">
        <summary>Impor Rekap Kehadiran (.xlsx)</summary>
        <form className="form" onSubmit={save}>
          <p className="muted small">Unggah Excel dengan sheet <b>Ringkasan</b> dan <b>Detail Peserta</b>. Impor menggantikan rekap sebelumnya untuk venue yang tercantum di file.</p>
          <input type="file" accept=".xlsx" aria-label="File Excel rekap kehadiran" onChange={(e) => { setFile(e.target.files[0]); setFeedback(null); }} disabled={busy} />
          <button type="submit" className="btn btn--primary" disabled={!file || busy}>{busy ? 'Menyimpan…' : 'Impor kehadiran'}</button>
          {feedback?.error && <p className="alert alert--err" role="alert">{feedback.error}</p>}
          {feedback?.result && <p className="alert alert--ok" role="status">
            {number.format(feedback.result.imported)} baris Detail Peserta diimpor untuk {feedback.result.venues} venue.
            {feedback.result.unmatched > 0 && ` ${number.format(feedback.result.unmatched)} baris kedatangan belum terhubung ke profil absensi.`}
          </p>}
        </form>
      </details>
    </>
  );
}
