import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';

export default function Settings() {
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { api('/admin/settings', { admin: true }).then(setS); }, []);
  if (!s) return <p className="muted">Memuat…</p>;
  const f = (k) => (e) => setS({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    try {
      setS(await api('/admin/settings', { method: 'PUT', admin: true, body: s }));
      setMsg({ text: 'Pengaturan disimpan.' });
    } catch (e) { setMsg({ err: true, text: e.message }); }
  }

  return (
    <>
      <div className="page-head"><div><h2>Pengaturan</h2><p className="muted">Lokasi absensi diatur di menu <Link to="/admin/venue">Venue</Link>.</p></div></div>
      <form className="card form form--grid" onSubmit={save}>
        <label className="span2">Nama acara<input value={s.event_name} onChange={f('event_name')} /></label>
        <label>Penyelenggara<input value={s.organizer} onChange={f('organizer')} placeholder="Dinas Pendidikan Kota …" /></label>
        <label>Tanggal acara (teks)<input value={s.event_dates} onChange={f('event_dates')} placeholder="10–12 November 2026" /></label>
        <label>Akurasi GPS maksimum (meter)
          <input type="number" min="5" value={s.max_accuracy_m} onChange={f('max_accuracy_m')} />
          <small className="muted">Absen ditolak bila akurasi GPS HP lebih buruk dari ini. 50–100 m wajar untuk dalam ruangan.</small>
        </label>
        <span />
        <label className="check span2">
          <input type="checkbox" checked={s.require_venue_code} onChange={f('require_venue_code')} />
          <span><b>Wajibkan Kode Venue</b> — peserta harus memasukkan kode 6 digit yang berganti tiap 30 detik di layar panitia
            venue masing-masing. Ini lapisan terkuat melawan Fake GPS karena kode hanya terlihat oleh orang yang benar-benar ada di lokasi.</span>
        </label>
        {msg && <div className={`alert span2 ${msg.err ? 'alert--err' : 'alert--ok'}`}>{msg.text}</div>}
        <div className="row span2"><button className="btn btn--primary">Simpan</button></div>
      </form>
    </>
  );
}
