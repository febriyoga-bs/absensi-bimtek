import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, adminUrl } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { fmtDT, FLAG_LABEL } from './shared.js';

const ST_LABEL = { valid: 'Valid', review: 'Perlu dicek', ditolak: 'Ditolak' };

export default function Records() {
  const [params, setParams] = useSearchParams();
  const [sessions, setSessions] = useState([]);
  const [venues, setVenues] = useState([]);
  const [rows, setRows] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [tab, setTab] = useState('absen');
  const [zoom, setZoom] = useState(null);
  const sid = params.get('sesi') || '';
  const status = params.get('status') || '';
  const venue = params.get('venue') || '';
  const setParam = (k, v) => setParams({ sesi: sid, status, venue, [k]: v });

  useEffect(() => {
    api('/admin/venues', { admin: true }).then(setVenues);
    api('/admin/sessions', { admin: true }).then((s) => {
      setSessions(s);
      if (!sid && s.length) setParams({ sesi: (s.find((x) => x.is_open) || s[s.length - 1]).id });
    });
  }, []);

  const load = () => {
    if (!sid) return;
    const qs = new URLSearchParams({ session_id: sid, ...(status && { status }), ...(venue && { venue_id: venue }) });
    api(`/admin/attendance?${qs}`, { admin: true }).then(setRows);
    api(`/admin/attempts?session_id=${sid}`, { admin: true }).then(setAttempts);
  };
  useEffect(load, [sid, status, venue]);

  async function setStatus(id, st) {
    await api(`/admin/attendance/${id}`, { method: 'PATCH', admin: true, body: { status: st } });
    setRows((r) => r.map((x) => (x.id === id ? { ...x, status: st } : x)));
  }

  return (
    <>
      <div className="page-head"><div><h2>Verifikasi Absensi</h2>
        <p className="muted">Absen bertanda kuning terdeteksi mencurigakan. Periksa fotonya, lalu sahkan atau tolak.</p></div></div>
      <div className="toolbar">
        <select value={sid} onChange={(e) => setParam('sesi', e.target.value)}>
          {sessions.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
        </select>
        <select value={venue} onChange={(e) => setParam('venue', e.target.value)}>
          <option value="">Semua venue</option>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setParam('status', e.target.value)}>
          <option value="">Semua status</option>
          <option value="review">Perlu dicek</option>
          <option value="valid">Valid</option>
          <option value="ditolak">Ditolak</option>
        </select>
        <button className="btn btn--sm" onClick={load}><Icon name="refresh" size={15} />Muat ulang</button>
        {sid && <a className="btn btn--sm" href={adminUrl(`/export?session_id=${sid}`)}><Icon name="download" size={15} />Unduh CSV</a>}
      </div>
      <div className="tabs">
        <button className={tab === 'absen' ? 'on' : ''} onClick={() => setTab('absen')}>Absensi masuk ({rows.length})</button>
        <button className={tab === 'blok' ? 'on' : ''} onClick={() => setTab('blok')}>Percobaan diblokir ({attempts.length})</button>
      </div>

      {tab === 'absen' && (
        <div className="grid">
          {rows.map((r) => (
            <div key={r.id} className={`rec rec--${r.status}`}>
              <img src={r.photo_url || adminUrl(`/photo/${r.id}`)} alt={r.name} loading="lazy"
                onClick={() => setZoom(r.photo_url || adminUrl(`/photo/${r.id}`))} />
              <div className="rec__body">
                <div className="rec__name">{r.name} <span className={`tag tag--${r.role}`}>{r.role}</span></div>
                <div className="muted small">{r.code} · {r.institution || '-'}</div>
                {r.venue_name && <div><span className="tag tag--venue">{r.venue_name}</span></div>}
                <div className="small">{fmtDT(r.created_at)} · {Math.round(r.distance_m)} m · ±{Math.round(r.accuracy_m)} m</div>
                <a className="small" href={`https://maps.google.com/?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer">Lihat di peta</a>
                {r.flags.length > 0 && (
                  <ul className="flags">
                    {r.flags.map((f, i) => <li key={i} title={f.detail}>{FLAG_LABEL[f.code] || f.code}<br /><small>{f.detail}</small></li>)}
                  </ul>
                )}
                <div className="row">
                  <span className={`st st--${r.status}`}>{ST_LABEL[r.status]}</span>
                  {r.status !== 'valid' && <button className="btn btn--sm btn--ok" onClick={() => setStatus(r.id, 'valid')}>Sahkan</button>}
                  {r.status !== 'ditolak' && <button className="btn btn--sm btn--danger" onClick={() => setStatus(r.id, 'ditolak')}>Tolak</button>}
                </div>
              </div>
            </div>
          ))}
          {!rows.length && <p className="muted">Belum ada data.</p>}
        </div>
      )}

      {tab === 'blok' && (
        <table className="table">
          <thead><tr><th>Waktu</th><th>Nama</th><th>Alasan</th><th>Jarak</th><th>Peta</th></tr></thead>
          <tbody>
            {attempts.map((a) => (
              <tr key={a.id}>
                <td className="small">{fmtDT(a.created_at)}</td>
                <td>{a.name} <span className="muted small">{a.code}</span></td>
                <td className="small">{a.reasons.join(' ')}</td>
                <td>{a.distance_m != null ? `${Math.round(a.distance_m)} m` : '-'}</td>
                <td>{a.lat != null && <a href={`https://maps.google.com/?q=${a.lat},${a.lng}`} target="_blank" rel="noreferrer">peta</a>}</td>
              </tr>
            ))}
            {!attempts.length && <tr><td colSpan={5} className="muted">Tidak ada.</td></tr>}
          </tbody>
        </table>
      )}

      {zoom && <div className="modal" onClick={() => setZoom(null)}><img src={zoom} alt="" /></div>}
    </>
  );
}
