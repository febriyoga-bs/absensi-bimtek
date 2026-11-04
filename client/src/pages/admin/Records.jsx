import { useEffect, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { api, adminUrl } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { MapModal } from '../../components/MapEmbed.jsx';
import { fmtDT, FLAG_LABEL } from './shared.js';
import { SkelCards } from '../../components/Skeleton.jsx';

const ST_LABEL = { valid: 'Valid', review: 'Perlu dicek', ditolak: 'Ditolak' };
const PAGE = 48;
const dist = (m) => (m == null ? '-' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

export default function Records() {
  const [params, setParams] = useSearchParams();
  const [sessions, setSessions] = useState([]);
  const [venues, setVenues] = useState([]);
  const { lo } = useOutletContext() || {};
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [attempts, setAttempts] = useState([]);
  const [tab, setTab] = useState('absen');
  const [zoom, setZoom] = useState(null);
  const [mapPoint, setMapPoint] = useState(null);
  const sid = params.get('sesi') || '';
  const status = params.get('status') || '';
  const venue = lo ? '' : params.get('venue') || '';
  const page = Math.max(Number(params.get('hal')) || 1, 1);
  // ganti filter → kembali ke halaman 1
  const setParam = (k, v) => setParams({ sesi: sid, status, venue, hal: '1', [k]: v });
  const pages = Math.max(Math.ceil(total / PAGE), 1);

  useEffect(() => {
    api('/admin/venues', { admin: true }).then(setVenues);
    api('/admin/sessions', { admin: true }).then((s) => {
      setSessions(s);
      if (!sid && s.length) setParams({ sesi: (s.find((x) => x.is_open) || s[s.length - 1]).id });
      if (!s.length) setLoading(false);
    });
  }, []);

  const load = () => {
    if (!sid) return;
    const qs = new URLSearchParams({
      session_id: sid, limit: PAGE, offset: (page - 1) * PAGE,
      ...(status && { status }), ...(venue && { venue_id: venue }),
    });
    setLoading(true);
    api(`/admin/attendance?${qs}`, { admin: true })
      .then((d) => { setRows(d.rows); setTotal(d.total); setCounts(d.counts); window.scrollTo({ top: 0 }); })
      .finally(() => setLoading(false));
    api(`/admin/attempts?session_id=${sid}${venue ? `&venue_id=${venue}` : ''}`, { admin: true }).then(setAttempts);
  };
  useEffect(load, [sid, status, venue, page]);

  async function setStatus(id, st) {
    await api(`/admin/attendance/${id}`, { method: 'PATCH', admin: true, body: { status: st } });
    setRows((r) => r.map((x) => (x.id === id ? { ...x, status: st } : x)));
    // perbarui hitungan per status tanpa memuat ulang halaman
    setCounts((c) => {
      if (!c) return c;
      const old = rows.find((x) => x.id === id)?.status;
      return old && old !== st ? { ...c, [old]: c[old] - 1, [st]: c[st] + 1 } : c;
    });
  }

  return (
    <>
      <div className="page-head"><div><h2>Verifikasi Absensi</h2>
        <p className="muted">Absen bertanda kuning terdeteksi mencurigakan. Periksa fotonya, lalu sahkan atau tolak.</p></div></div>
      <div className="toolbar">
        <select value={sid} onChange={(e) => setParam('sesi', e.target.value)}>
          {sessions.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
        </select>
        {!lo && venues.length > 1 && (
          <select value={venue} onChange={(e) => setParam('venue', e.target.value)}>
            <option value="">Semua venue</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
        <select value={status} onChange={(e) => setParam('status', e.target.value)}>
          <option value="">Semua status{counts ? ` (${counts.total})` : ''}</option>
          <option value="review">Perlu dicek{counts ? ` (${counts.review})` : ''}</option>
          <option value="valid">Valid{counts ? ` (${counts.valid})` : ''}</option>
          <option value="ditolak">Ditolak{counts ? ` (${counts.ditolak})` : ''}</option>
        </select>
        <button className="btn btn--sm" onClick={load}><Icon name="refresh" size={15} />Muat ulang</button>
        {sid && <a className="btn btn--sm" href={adminUrl(`/export?session_id=${sid}${venue ? `&venue_id=${venue}` : ''}`)}><Icon name="download" size={15} />Unduh CSV</a>}
      </div>
      <div className="tabs">
        <button className={tab === 'absen' ? 'on' : ''} onClick={() => setTab('absen')}>Absensi masuk ({total})</button>
        <button className={tab === 'blok' ? 'on' : ''} onClick={() => setTab('blok')}>Percobaan diblokir ({attempts.length})</button>
      </div>

      {tab === 'absen' && loading && !rows.length && <div className="grid"><SkelCards n={4} h={200} /></div>}
      {tab === 'absen' && (
        <div className="grid" style={loading && rows.length ? { opacity: 0.5, transition: 'opacity .2s' } : undefined}>
          {rows.map((r) => (
            <div key={r.id} className={`rec rec--${r.status}`}>
              <div>
                {r.method && r.method !== 'selfie'
                  ? <div className="rec__qr"><Icon name={r.method === 'qr' ? 'qr' : 'users'} size={40} />
                    <b>{r.method === 'qr' ? 'Scan QR' : 'Diabsenkan LO'}</b><small>{r.scanned_by || 'LO / panitia'}</small></div>
                  : <img src={r.photo_url || adminUrl(`/photo/${r.id}`)} alt={r.name} loading="lazy" title="Klik untuk memperbesar"
                    onClick={() => setZoom(r.photo_url || adminUrl(`/photo/${r.id}`))} />}
              </div>
              <div className="rec__body">
                <div className="rec__name">{r.name} <span className={`tag tag--${r.role}`}>{r.role}</span></div>
                <div className="muted small">{r.code} · {r.institution || '-'}</div>
                {r.venue_name && <div><span className="tag tag--venue">{r.venue_name}</span></div>}
                {r.lat == null ? <div className="small">{fmtDT(r.created_at)} WIB · {r.method === 'qr' ? 'dipindai' : 'diabsenkan'} {r.scanned_by || 'LO'}</div> : <>
                <div className="small">{fmtDT(r.created_at)} WIB · {dist(r.distance_m)} dari venue · akurasi ±{Math.round(r.accuracy_m)} m</div>
                <div className="rec__geo">{Number(r.lat).toFixed(6)}, {Number(r.lng).toFixed(6)}</div>
                <button type="button" className="link-btn" onClick={() => setMapPoint({
                  lat: r.lat, lng: r.lng, title: `${r.name} — ${r.venue_name || 'lokasi absen'}`,
                  rows: [['Waktu', fmtDT(r.created_at) + ' WIB'], ['Venue', r.venue_name], ['Jarak ke venue', dist(r.distance_m)],
                    ['Akurasi GPS', `±${Math.round(r.accuracy_m)} m`], ['Status', ST_LABEL[r.status]]],
                })}><Icon name="pin" size={14} />Lihat di peta</button></>}
                {r.flags.some((f) => f.code !== 'qr_lo') && (
                  <ul className="flags">
                    {r.flags.filter((f) => f.code !== 'qr_lo').map((f, i) => <li key={i} title={f.detail}>{FLAG_LABEL[f.code] || f.code}<br /><small>{f.detail}</small></li>)}
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
          {!rows.length && !loading && <p className="muted">Belum ada data.</p>}
        </div>
      )}
      {tab === 'absen' && pages > 1 && (
        <div className="pager">
          <button className="btn btn--sm" disabled={page <= 1 || loading} onClick={() => setParam('hal', String(page - 1))}><Icon name="left" size={15} />Sebelumnya</button>
          <span className="muted small">Halaman <b>{page}</b> dari {pages} · {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} dari {total}</span>
          <button className="btn btn--sm" disabled={page >= pages || loading} onClick={() => setParam('hal', String(page + 1))}>Berikutnya<Icon name="right" size={15} /></button>
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
                <td>{dist(a.distance_m)}</td>
                <td>{a.lat != null && (
                  <button type="button" className="link-btn" onClick={() => setMapPoint({
                    lat: a.lat, lng: a.lng, title: `${a.name || 'Percobaan'} — diblokir`,
                    rows: [['Waktu', fmtDT(a.created_at) + ' WIB'], ['Venue terdekat', a.venue_name], ['Jarak', dist(a.distance_m)],
                      ['Akurasi GPS', a.accuracy_m != null ? `±${Math.round(a.accuracy_m)} m` : null], ['Alasan', a.reasons.join(' ')]],
                  })}><Icon name="pin" size={14} />peta</button>)}</td>
              </tr>
            ))}
            {!attempts.length && <tr><td colSpan={5} className="muted">Tidak ada.</td></tr>}
          </tbody>
        </table>
      )}

      {zoom && <div className="modal" onClick={() => setZoom(null)}><img src={zoom} alt="" /></div>}
      <MapModal point={mapPoint} onClose={() => setMapPoint(null)} />
    </>
  );
}
