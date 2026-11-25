import FilterField from '../../components/FilterField.jsx';
import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../api.js';
import { selectedEvent } from '../../event.js';
import { fmtFull } from '../../lib/time.js';
import { SkelCards } from '../../components/Skeleton.jsx';
import ArrivalBreakdown from '../../components/ArrivalBreakdown.jsx';
import ArrivalTotals from '../../components/ArrivalTotals.jsx';
import { arrivalBadge } from './shared.js';
import ArrivalImport from './ArrivalImport.jsx';

const number = new Intl.NumberFormat('id-ID');
const groups = [
  { key: 'invited', label: 'Undangan', title: 'Daftar Undangan', icon: 'fa-users' },
  { key: 'arrived', label: 'Sudah tiba', title: 'Peserta Sudah Tiba', icon: 'fa-circle-check' },
  { key: 'queued', label: 'Sedang antre', title: 'Peserta Sedang Antre', icon: 'fa-clock' },
];

export default function ArrivalRecap() {
  const { user } = useOutletContext();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
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
      return true;
    } catch (e) { setError(e.message); return false; }
  }
  useEffect(() => { refresh(); }, []);

  return (
    <>
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
      {user?.role === 'admin' && (selectedEvent()?.id === 5
        ? <Link className="btn" to="/admin/pks">Impor kehadiran di Pantau Rekap PKS</Link>
        : <ArrivalImport onImported={refresh} />)}
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
            <FilterField label="Cari nama atau instansi"><input type="search" aria-label="Cari nama atau instansi" placeholder="Cari nama atau instansi"
              value={query} onChange={(e) => setQuery(e.target.value)} /></FilterField>
            <FilterField label="Jenis peserta"><select aria-label="Jenis peserta" value={position} onChange={(e) => setPosition(e.target.value)}>
              <option value="">Semua jenis peserta</option>
              {positions.map((item) => <option key={item}>{item}</option>)}
            </select></FilterField>
            {selection.group.key === 'invited' && <FilterField label="Status kedatangan"><select aria-label="Status kedatangan" value={arrival} onChange={(e) => setArrival(e.target.value)}>
              <option value="">Semua status kedatangan</option>
              <option>Sudah tiba</option>
              <option>Sedang antre</option>
              <option>Belum tiba</option>
              <option>Belum terdata</option>
            </select></FilterField>}
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
