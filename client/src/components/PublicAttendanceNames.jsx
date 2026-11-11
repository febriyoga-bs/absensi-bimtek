import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function PublicAttendanceNames({ selection, onClose }) {
  const dialog = useRef(null);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    dialog.current.showModal();
    let active = true;
    const params = new URLSearchParams({ group: selection.group, period: selection.period, scope: selection.scope });
    api(`/dashboard/absensi/${selection.id}/participants?${params}`)
      .then((data) => { if (active) setRows(data); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [selection]);
  const term = query.trim().toLocaleLowerCase('id');
  const visible = rows?.filter((row) => `${row.name} ${row.institution}`.toLocaleLowerCase('id').includes(term));
  return <dialog ref={dialog} className="assignment-dialog" aria-labelledby="public-attendance-names" onClose={onClose}>
    <header><div><h3 id="public-attendance-names">{selection.label} · {selection.scope === 'all' ? 'Target absensi' : 'Sudah absen'}</h3>
      <p className="muted small">{selection.venue} · {selection.period}</p></div>
      <button type="button" className="btn btn--sm" onClick={onClose}>Tutup</button></header>
    <input autoFocus type="search" aria-label="Cari nama atau instansi" placeholder="Cari nama atau instansi" value={query} onChange={(event) => setQuery(event.target.value)} />
    {error && <p className="alert alert--err" role="alert">{error}</p>}
    {!rows && !error && <p role="status">Memuat daftar nama…</p>}
    {visible && <><p className="muted small" role="status">{visible.length} dari {rows.length} nama</p>
      <ol>{visible.map((row, index) => <li key={index}><b>{row.name}</b>
        {row.institution && <div className="muted small">{row.institution}</div>}
        <span className={`tag ${row.checked_in ? 'tag--open' : 'tag--off'}`}>{row.checked_in ? 'Sudah absen' : 'Belum absen'}</span>
      </li>)}</ol>{!visible.length && <p className="muted">Tidak ada nama yang cocok.</p>}</>}
  </dialog>;
}
