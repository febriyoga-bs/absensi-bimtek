import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../api.js';
import { readArrivalWorkbook } from '../../lib/reportingFiles.js';
import { fmtFull } from '../../lib/time.js';
import { SkelCards, Spinner } from '../../components/Skeleton.jsx';
import ArrivalBreakdown from '../../components/ArrivalBreakdown.jsx';
import ArrivalTotals from '../../components/ArrivalTotals.jsx';
import { arrivalBadge } from './shared.js';

const number = new Intl.NumberFormat('id-ID');
const groups = [
  { key: 'invited', label: 'Undangan', title: 'Daftar Undangan', icon: 'fa-users' },
  { key: 'arrived', label: 'Sudah tiba', title: 'Peserta Sudah Tiba', icon: 'fa-circle-check' },
  { key: 'queued', label: 'Sedang antre', title: 'Peserta Sedang Antre', icon: 'fa-clock' },
];

export default function ArrivalRecap() {
  const { user } = useOutletContext();
  const [rows, setRows] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [importStage, setImportStage] = useState('');
  const [showImportResult, setShowImportResult] = useState(false);
  const importDialog = useRef(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [selection, setSelection] = useState(null);
  const [participants, setParticipants] = useState(null);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState('');
  const [arrival, setArrival] = useState('');
  const dialog = useRef(null);
  const latestImport = rows?.reduce((latest, venue) =>
    venue.imported_at && (!latest || venue.imported_at > latest) ? venue.imported_at : latest, null);
  const entries = participants?.entries;
  const positions = [...new Set(entries?.map((person) => person.position).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
  const search = query.trim().toLowerCase();
  const visibleEntries = entries?.filter((person) =>
    (!position || person.position === position) &&
    (!arrival || arrivalBadge(person.arrival_status)[0] === arrival) &&
    [person.name, person.institution].some((value) => (value || '').toLowerCase().includes(search)));
  useEffect(() => {
    if ((busy || showImportResult) && !importDialog.current.open) importDialog.current.showModal();
  }, [busy, showImportResult]);

  useEffect(() => {
    if (!selection) return;
    if (!dialog.current.open) dialog.current.showModal();
    let current = true;
    api(`/admin/arrival-recap/${selection.venue.id}/participants?group=${selection.group.key}`, { admin: true })
      .then((entries) => { if (current) setParticipants({ entries }); })
      .catch((e) => { if (current) setParticipants({ error: e.message }); });
    return () => { current = false; };
  }, [selection]);

  async function refresh() {
    try {
      setRows(await api('/admin/arrival-recap', { admin: true }));
      setError('');
      return true;
    } catch (e) { setError(e.message); return false; }
  }
  useEffect(() => { refresh(); }, []);

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
      setImportStage('Impor tersimpan. Memperbarui tampilan rekap…');
      const refreshed = await refresh();
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
            {feedback.refreshFailed && <p className="alert alert--warn">Data sudah tersimpan, tetapi tampilan rekap gagal diperbarui. Klik Muat ulang.</p>}
          </>}
        {!busy && <button type="button" className="btn btn--primary" onClick={() => importDialog.current.close()}>Tutup</button>}
      </dialog>
      <div className="page-head">
        <div><h2>Rekap Kehadiran</h2><p className="muted">Kedatangan peserta berdasarkan Excel yang diimpor.</p></div>
        <div className="public-dashboard__tools">
          <button type="button" className="btn" onClick={refresh}>Muat ulang</button>
          {rows && <p className="muted small public-dashboard__updated" role="status">
            Impor terakhir · {latestImport ? fmtFull(latestImport) : 'Belum ada impor'}
          </p>}
          <Link className="btn" to="/admin/scan">{user?.role === 'lo' ? 'Absenkan Peserta' : 'Daftar Peserta'}</Link>
        </div>
      </div>
      <p className="muted small">Jumlah Pengawas adalah akun terdaftar, bukan undangan. Angka dari Ringkasan Excel dapat berbeda dari jumlah baris Detail Peserta yang ditampilkan pada daftar.</p>
      <ArrivalTotals venues={(rows || []).filter((venue) => venue.source_ready)} />
      {user?.role === 'admin' && <details className="card arrival-import">
        <summary>Impor Rekap Kehadiran (.xlsx)</summary>
        <form className="form" onSubmit={save}>
          <p className="muted small">Unggah Excel dengan sheet <b>Ringkasan</b> dan <b>Detail Peserta</b>. Angka mengikuti Ringkasan; daftar dan pencocokan profil menggunakan Detail Peserta. Jumlah Pengawas adalah akun terdaftar, bukan undangan. Jumlah baris detail dapat berbeda dari Ringkasan.</p>
          <p className="muted small">Status Selesai dan Sudah Tiba ditampilkan sebagai Sudah tiba. Status Sedang Antri ditampilkan sebagai Sedang antre.</p>
          <input type="file" accept=".xlsx" aria-label="File Excel rekap kehadiran" onChange={(e) => { setFile(e.target.files[0]); setFeedback(null); }} disabled={busy} />
          <button type="submit" className="btn btn--primary" disabled={!file || busy}>{busy ? 'Menyimpan…' : 'Impor kehadiran'}</button>
          {feedback?.error && <p className="alert alert--err" role="alert">{feedback.error}</p>}
          {feedback?.result && <p className="alert alert--ok" role="status">
            {number.format(feedback.result.imported)} baris Detail Peserta diimpor untuk {feedback.result.venues} venue.
            {feedback.result.unmatched > 0 && ` ${number.format(feedback.result.unmatched)} baris kedatangan belum terhubung ke profil absensi.`}
          </p>}
        </form>
      </details>}
      {error && <p className="alert alert--err" role="alert">{error}</p>}
      {!rows && !error && <div className="stats"><SkelCards n={3} h={96} /></div>}
      {rows && <div className="venue-attendance-grid">
        {rows.map((venue) => (
          <article key={venue.id} className="venue-attendance">
            <div className="venue-attendance__head">
              <span className="arrival-venue-icon"><i className="fa-solid fa-location-dot" aria-hidden="true" /></span>
              <div className="arrival-venue-heading">
                <h3>{venue.name}</h3>
                {user?.role === 'lo' && user.venue?.id === venue.id && <span className="tag tag--venue">Venue Anda</span>}
              </div>
            </div>
            {venue.source_ready && <div className="venue-attendance__groups arrival-venue-metrics">
              {groups.map((group) => <button key={group.key} type="button" aria-haspopup="dialog"
                className={`arrival-metric--${group.key}`}
                aria-label={`${number.format(venue[group.key])} ${group.label} di ${venue.name}`}
                onClick={() => { setParticipants(null); setSelection({ venue, group }); }}>
                <span className="arrival-metric__value">
                  <i className={`fa-solid ${group.icon}`} aria-hidden="true" />
                  <b>{number.format(venue[group.key])}</b>
                </span>
                <span className="arrival-metric__label">{group.label}</span>
              </button>)}
            </div>}
            <ArrivalBreakdown rows={venue.breakdown} />
            {!venue.source_ready && <small className="muted arrival-venue-import">
              {venue.imported_at ? 'Admin Utama perlu mengimpor ulang file Detail Peserta.' : 'Belum ada impor Detail Peserta.'}
            </small>}
          </article>
        ))}
      </div>}
      <dialog ref={dialog} className="assignment-dialog" aria-labelledby="arrival-detail-title"
        onClose={() => { setSelection(null); setQuery(''); setPosition(''); setArrival(''); }}>
        {selection && <>
          <header>
            <div>
              <h3 id="arrival-detail-title">{selection.group.title}</h3>
              <p className="muted small">{selection.venue.name}</p>
              {entries && <span className="assignment-detail-count" role="status">
                {visibleEntries.length !== entries.length ? `${number.format(visibleEntries.length)} dari ` : ''}
                {number.format(entries.length)} peserta
              </span>}
            </div>
            <form method="dialog"><button className="btn btn--sm" autoFocus>Tutup</button></form>
          </header>
          {!!entries?.length && <div className="arrival-detail-filters" role="group" aria-label="Filter peserta">
            <input type="search" aria-label="Cari nama atau instansi" placeholder="Cari nama atau instansi"
              value={query} onChange={(e) => setQuery(e.target.value)} />
            <select aria-label="Jenis peserta" value={position} onChange={(e) => setPosition(e.target.value)}>
              <option value="">Semua jenis peserta</option>
              {positions.map((item) => <option key={item}>{item}</option>)}
            </select>
            {selection.group.key === 'invited' && <select aria-label="Status kedatangan" value={arrival} onChange={(e) => setArrival(e.target.value)}>
              <option value="">Semua status kedatangan</option>
              <option>Sudah tiba</option>
              <option>Sedang antre</option>
              <option>Belum terdata</option>
            </select>}
          </div>}
          {!participants && <p className="muted" role="status">Memuat daftar peserta…</p>}
          {participants?.error && <p className="alert alert--err" role="alert">{participants.error}</p>}
          {visibleEntries?.length === 0 && <p className="muted">
            {entries.length ? 'Tidak ada peserta yang cocok dengan filter.' : 'Belum ada peserta dalam daftar ini.'}
          </p>}
          {!!visibleEntries?.length && <ol>
            {visibleEntries.map((person) => {
              const [label, style] = arrivalBadge(person.arrival_status);
              return <li key={person.id}>
                <b>{person.name}</b>
                <div className="muted small">{[person.position, person.institution].filter(Boolean).join(' · ')}</div>
                <span className={`tag ${style}`}>{label}</span>
              </li>;
            })}
          </ol>}
        </>}
      </dialog>
    </>
  );
}
