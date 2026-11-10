import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { SkelRows } from '../../components/Skeleton.jsx';

const number = new Intl.NumberFormat('id-ID');
const PAGE_SIZE = 30;
const detailLists = {
  facilitator_count: 'facilitators',
  school_count: 'schools',
  coordinator_count: 'coordinators',
  supervisor_count: 'supervisors',
};
const reports = {
  lo: {
    label: 'LO',
    columns: [
      ['name', 'Nama LO'], ['venue', 'Venue'], ['rooms', 'Ruangan yang dicakup'],
      ['facilitator_count', 'Fasilitator'], ['school_count', 'Sekolah'],
      ['coordinator_count', 'Koordinator'], ['supervisor_count', 'Pengawas'],
    ],
    search: ['name', 'rooms'],
  },
  facilitators: {
    label: 'Fasilitator',
    columns: [
      ['name', 'Nama fasilitator'], ['lo', 'LO'], ['venue', 'Venue'], ['room', 'Ruangan'],
      ['group', 'Kelompok'], ['institution', 'PTN'], ['coordinator', 'Koordinator'], ['school_count', 'Sekolah'],
    ],
    search: ['name', 'institution', 'coordinator', 'group', 'room', 'lo'],
  },
  schools: {
    label: 'Sekolah',
    columns: [
      ['name', 'Nama sekolah'], ['npsn', 'NPSN'], ['city', 'Kabupaten/kota'], ['lo', 'LO'],
      ['facilitator', 'Fasilitator'], ['venue', 'Venue'], ['room', 'Ruangan'], ['group', 'Kelompok'],
    ],
    search: ['name', 'npsn', 'city', 'facilitator', 'group', 'room', 'lo'],
  },
};

export default function Assignments({ personal = false }) {
  const { user, lo: isLo } = useOutletContext();
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(personal ? 'facilitators' : 'lo');
  const [venue, setVenue] = useState('');
  const [lo, setLo] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [details, setDetails] = useState(null);
  const dialog = useRef(null);

  useEffect(() => {
    if (!user) return;
    let current = true;
    api(personal ? '/admin/assignments/mine' : '/admin/assignments', { admin: true })
      .then((result) => { if (current) setData(result); })
      .catch((e) => { if (current) setError(e.message); })
      .finally(() => { if (current) setLoaded(true); });
    return () => { current = false; };
  }, [user?.role, personal]);

  useEffect(() => {
    if (details && !dialog.current.open) dialog.current.showModal();
  }, [details]);

  const report = reports[tab];
  const term = query.trim().toLowerCase();
  const rows = (data?.[tab] || []).filter((row) =>
    (!venue || row.venue === venue) && (!lo || (tab === 'lo' ? row.name : row.lo) === lo) &&
    (!term || report.search.some((field) => String(row[field] ?? '').toLowerCase().includes(term))));
  const pages = Math.ceil(rows.length / PAGE_SIZE);
  const start = (page - 1) * PAGE_SIZE;

  function changeTab(key) {
    setTab(key);
    setQuery('');
    setPage(1);
  }

  function showDetails(row, field, label) {
    const entries = data[detailLists[field]]?.filter((entry) => entry.venue === row.venue && entry.lo === row.name);
    setDetails({ label, owner: row.name, venue: row.venue, entries });
  }

  function exportCsv() {
    const escape = (value) => {
      let text = String(value ?? '');
      if (typeof value === 'string' && /^(?:\s*[=+@-]|[\t\r\n])/.test(text)) text = "'" + text;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = [
      report.columns.map(([, label]) => label),
      ...rows.map((row) => report.columns.map(([field]) => row[field])),
    ].map((row) => row.map(escape).join(',')).join('\r\n');
    const href = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = ['rekap', report.label, venue, lo].filter(Boolean).join('-')
      .toLowerCase().replace(/[^a-z0-9-]+/g, '-') + '.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  return (
    <>
      <div className="page-head assignment-heading">
        <span className="assignment-heading__icon"><Icon name={personal ? 'list' : 'chart'} size={26} /></span>
        <div>
          <h2>{personal ? 'Daftar Pendampingan' : 'Rekap Pendampingan'}</h2>
          <p className="muted">{personal ? 'Fasilitator, sekolah binaan, dan ruangan dalam penugasan Anda.'
            : 'Pembagian LO, fasilitator pelaporan, dan sekolah binaan sesuai pemetaan Bimtek Pelaporan 3 revisi 8.'}</p>
        </div>
      </div>
      {error && <p className="alert alert--err" role="alert">{error}</p>}
      {loaded && !data && !error && <p className="muted">{personal ? 'Belum ada penugasan untuk akun ini.' : 'Data pembagian tugas belum diimpor.'}</p>}
      {data && (
        <>
          {personal && <div className="card assignment-location">
            <Icon name="pin" size={22} />
            <div>
              <b>{data.lo[0].venue}</b>
              <div className="muted small">Ruangan yang dicakup</div>
              <div>{data.lo[0].rooms}</div>
            </div>
          </div>}
          <div className="assignment-controls">
          <div className="assignment-tabs" role="group" aria-label="Jenis rekap">
            {Object.entries(reports).filter(([key]) => !personal || key !== 'lo').map(([key, { label }]) => (
              <button key={key} type="button" className={key === tab ? 'on' : ''} aria-pressed={key === tab}
                onClick={() => changeTab(key)}>{label} <span>{number.format(data[key].length)}</span></button>
            ))}
          </div>
          <div className="toolbar assignment-filters">
            {!personal && <select aria-label="Filter venue" value={venue} onChange={(e) => {
              setVenue(e.target.value); setLo(''); setPage(1);
            }}>
              <option value="">Semua venue</option>
              {data.venues.map((name) => <option key={name}>{name}</option>)}
            </select>}
            {!personal && <select aria-label="Filter LO" value={lo} onChange={(e) => { setLo(e.target.value); setPage(1); }}>
              <option value="">Semua LO</option>
              {data.lo.filter((row) => !venue || row.venue === venue)
                .map(({ name }) => <option key={name}>{name}</option>)}
            </select>}
            <input type="search" aria-label={`Cari ${report.label}`} placeholder={`Cari ${report.label}…`}
              value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
            {!isLo && !personal && <button type="button" className="btn" disabled={!rows.length} onClick={exportCsv}>
              <Icon name="download" size={16} />Unduh CSV sesuai filter
            </button>}
          </div>
          <p className="assignment-results muted small" aria-live="polite">
            {rows.length ? `${number.format(start + 1)}–${number.format(Math.min(start + PAGE_SIZE, rows.length))} dari ${number.format(rows.length)} hasil` : '0 hasil'}
          </p>
          </div>
        </>
      )}
      {(data || !loaded) && (
        <div className="assignment-table">
          <table className="table stack-table assignment-grid" role="table" aria-label={`Rekap ${report.label}`}>
            <thead role="rowgroup"><tr role="row">{report.columns.map(([field, label]) => <th key={field} scope="col" role="columnheader">{label}</th>)}</tr></thead>
            <tbody role="rowgroup">
              {!loaded && <SkelRows rows={5} cols={report.columns.length} />}
              {data && !rows.length && <tr><td colSpan={report.columns.length}>Tidak ada hasil untuk filter ini.</td></tr>}
              {rows.slice(start, start + PAGE_SIZE).map((row, index) => (
                <tr key={row.npsn || start + index} role="row">
                  {report.columns.map(([field, label]) => (
                    <td key={field} role="cell" data-label={field === 'name' ? undefined : label}
                      className={field === 'rooms' || field === 'room' ? 'stack-full' : undefined}>
                      {tab === 'lo' && Object.hasOwn(detailLists, field) && row[field] != null
                      ? <button type="button" className="assignment-count" aria-haspopup="dialog"
                        aria-label={`${row[field]} ${label} untuk ${row.name}`}
                        onClick={() => showDetails(row, field, label)}>{number.format(row[field])}</button>
                      : field === 'venue' ? <span className="assignment-venue">{row[field]}</span> : row[field] ?? '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && <div className="pager">
        <button type="button" className="btn btn--sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Sebelumnya</button>
        <span>Halaman {page} dari {pages}</span>
        <button type="button" className="btn btn--sm" disabled={page === pages} onClick={() => setPage(page + 1)}>Berikutnya</button>
      </div>}
      <dialog ref={dialog} className="assignment-dialog" aria-labelledby="assignment-detail-title"
        onClose={() => setDetails(null)}>
        {details && <>
          <header>
            <div>
              <h3 id="assignment-detail-title">Daftar {details.label}</h3>
              <p className="muted small">{details.owner} · {details.venue}</p>
              {details.entries && <span className="assignment-detail-count">{number.format(details.entries.length)} hasil</span>}
            </div>
            <form method="dialog"><button className="btn btn--sm" autoFocus><Icon name="x" size={16} />Tutup</button></form>
          </header>
          {details.entries?.length > 0 && <ol>
            {details.entries.map((entry, index) => (
              <li key={entry.npsn || index}>
                <b>{entry.name}</b>
                <div className="muted small">
                  {[entry.npsn && `NPSN ${entry.npsn}`, entry.institution, entry.room].filter(Boolean).join(' · ')}
                </div>
              </li>
            ))}
          </ol>}
          {!details.entries && <p className="muted">Rincian belum dimuat.</p>}
          {details.entries?.length === 0 && <p className="muted">Tidak ada {details.label.toLowerCase()} untuk penugasan ini.</p>}
        </>}
      </dialog>
    </>
  );
}
