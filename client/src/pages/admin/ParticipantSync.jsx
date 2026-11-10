import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { Spinner } from '../../components/Skeleton.jsx';
import { formatRoom } from '../../lib/room.js';

const PAGE_SIZE = 30;
const number = new Intl.NumberFormat('id-ID');
const actions = {
  update: 'Diperbarui',
  add: 'Ditambahkan',
  archive: 'Diarsipkan',
  review: 'Perlu diperiksa',
};

export default function ParticipantSync() {
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [action, setAction] = useState('update');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);

  async function load() {
    setStatus('loading');
    setError('');
    setPreview(null);
    try {
      const next = await api('/admin/people/sync', { admin: true });
      setAction(Object.keys(actions).find((key) => next.summary[key]) || 'update');
      setTerm('');
      setPage(1);
      setPreview(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setStatus('');
    }
  }
  useEffect(() => { load(); }, []);

  async function apply() {
    if (!window.confirm('Terapkan perubahan pada pratinjau ini? Peserta yang diarsipkan tidak bisa mengisi absensi baru.')) return;
    setStatus('applying');
    setError('');
    try {
      const summary = await api('/admin/people/sync', {
        admin: true, method: 'POST', body: { revision: preview.revision },
      });
      setPreview(null);
      setResult(summary);
    } catch (e) {
      setError(e.message);
    } finally {
      setStatus('');
    }
  }

  const query = term.trim().toLowerCase();
  const rows = (preview?.items || []).filter((row) => row.action === action &&
    [row.code, row.name, row.npsn, row.from_venue, row.to_venue, row.from_room, row.to_room]
      .some((value) => String(value ?? '').toLowerCase().includes(query)));
  const pages = Math.ceil(rows.length / PAGE_SIZE);
  const first = (page - 1) * PAGE_SIZE;
  const changes = preview && (preview.summary.add + preview.summary.update + preview.summary.archive);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Pratinjau Sinkronisasi Absensi</h2>
          <p className="muted">Cocokkan daftar Bendahara dan Pengawas dengan pemetaan Bimtek Pelaporan 3 revisi 8.</p>
        </div>
        <Link className="btn" to="/admin/orang">Kembali ke Peserta &amp; Panitia</Link>
      </div>
      {status === 'loading' && <p><Spinner /> Memuat pratinjau…</p>}
      {error && <p className="alert alert--err" role="alert">{error}</p>}
      {result && <p className="alert alert--ok" role="status">
        Sinkronisasi selesai. {number.format(result.add)} ditambahkan, {number.format(result.update)} diperbarui, dan {number.format(result.archive)} diarsipkan.
        {result.review > 0 && ` ${number.format(result.review)} data masih perlu diperiksa.`}
      </p>}
      {preview && (
        <>
          {preview.inactiveVenues?.length > 0 && <p className="alert alert--warn">
            Absensi mandiri belum aktif di {preview.inactiveVenues.join(', ')}. <Link to="/admin/venue">Kelola venue</Link>
          </p>}
          <p className="muted">
            {number.format(preview.summary.moved)} peserta lama mendapat venue berbeda. {number.format(preview.summary.unchanged)} peserta sudah sesuai.
            {' '}Peserta yang diarsipkan tetap tercatat dalam riwayat absensi. Data yang perlu diperiksa dilewati saat sinkronisasi.
          </p>
          <div className="toolbar">
            <button className="btn btn--primary" onClick={apply} disabled={!!status || !changes}>
              {status === 'applying' ? 'Menerapkan…' : 'Terapkan Sinkronisasi'}
            </button>
            <button className="btn" onClick={load} disabled={!!status}>Muat Ulang Pratinjau</button>
          </div>
          <div className="tabs sync-tabs" role="group" aria-label="Jenis perubahan">
            {Object.entries(actions).map(([key, label]) => (
              <button key={key} type="button" className={key === action ? 'on' : ''} aria-pressed={key === action}
                onClick={() => { setAction(key); setPage(1); }}>{label} ({number.format(preview.summary[key])})</button>
            ))}
          </div>
          <div className="toolbar filters">
            <input type="search" aria-label="Cari perubahan peserta" placeholder="Cari nama, NPSN, venue, atau ruangan"
              value={term} onChange={(e) => { setTerm(e.target.value); setPage(1); }} />
            <span className="muted small" aria-live="polite">{number.format(rows.length)} hasil</span>
          </div>
          <div className="assignment-table">
            <table className="table stack-table" role="table" aria-label={actions[action]}>
              <thead><tr>
                <th scope="col">Peserta</th><th scope="col">NPSN</th><th scope="col">Penempatan saat ini</th>
                <th scope="col">Penempatan dari Excel</th>{action === 'review' && <th scope="col">Perlu diperiksa</th>}
              </tr></thead>
              <tbody>
                {rows.slice(first, first + PAGE_SIZE).map((row) => (
                  <tr key={`${row.code}:${row.npsn}`} role="row">
                    <td role="cell"><b>{row.name}</b><div className="muted small">{row.position} · {row.code}</div></td>
                    <td role="cell" data-label="NPSN" className="stack-full">{row.npsn || '—'}</td>
                    <td role="cell" data-label="Saat ini">{row.from_venue || '—'}{row.from_room && <div className="muted small">{formatRoom(row.from_room)}</div>}</td>
                    <td role="cell" data-label="Dari Excel">{row.to_venue || '—'}{row.to_room && <div className="muted small">{formatRoom(row.to_room)}</div>}
                      {row.restored && <div className="muted small">Diaktifkan kembali</div>}</td>
                    {action === 'review' && <td role="cell" data-label="Perlu diperiksa" className="stack-full">{row.reason}{row.candidates.map((p) => (
                      <div key={p.code} className="muted small">{p.name} ({p.code})</div>
                    ))}</td>}
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={action === 'review' ? 5 : 4}>Tidak ada data untuk kategori ini.</td></tr>}
              </tbody>
            </table>
          </div>
          {pages > 1 && <div className="pager">
            <button className="btn btn--sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Sebelumnya</button>
            <span>Halaman {page} dari {pages}</span>
            <button className="btn btn--sm" disabled={page === pages} onClick={() => setPage(page + 1)}>Berikutnya</button>
          </div>}
        </>
      )}
      {!preview && status !== 'loading' && (
        <button className="btn" onClick={load}>Muat Pratinjau</button>
      )}
    </>
  );
}
