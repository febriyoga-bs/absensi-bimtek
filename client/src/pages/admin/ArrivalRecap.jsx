import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../api.js';
import { readArrivalWorkbook } from '../../lib/reportingFiles.js';
import { useVisiblePolling } from '../../lib/poll.js';
import { fmtFull } from '../../lib/time.js';
import { SkelCards } from '../../components/Skeleton.jsx';
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
        <div className="public-dashboard__tools">
          {rows && <p className="muted small public-dashboard__updated" role="status">
            Impor terakhir · {latestImport ? fmtFull(latestImport) : 'Belum ada impor'}
          </p>}
          <Link className="btn" to="/admin/scan">{user?.role === 'lo' ? 'Absenkan Peserta' : 'Daftar Peserta'}</Link>
        </div>
      </div>
      <ArrivalTotals venues={(rows || []).filter((venue) => venue.source_ready)} />
      {user?.role === 'admin' && <details className="card arrival-import">
        <summary>Impor Rekap Kehadiran (.xlsx)</summary>
        <form className="form" onSubmit={save}>
          <p className="muted small">Unggah file Excel yang memuat sheet <b>Detail Peserta</b>. Impor mengganti angka dan daftar pada venue yang tercantum dalam file.</p>
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
