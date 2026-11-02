import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { MapEmbed, MapModal, validCoord } from '../../components/MapEmbed.jsx';

const blank = { id: null, name: '', address: '', lat: '', lng: '', radius_m: 150, active: true };

export default function Venues() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState(blank);
  const [msg, setMsg] = useState(null);
  const [locating, setLocating] = useState(false);
  const [mapPoint, setMapPoint] = useState(null);

  const load = () => api('/admin/venues', { admin: true }).then(setList);
  useEffect(() => { load(); }, []);
  const f = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  /** Terima tempelan "lat, lng" dari Google Maps (klik kanan titik → salin koordinat) */
  function pasteCoords(e) {
    const m = e.target.value.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    if (m) setForm({ ...form, lat: m[1], lng: m[2] });
  }

  function useMyLocation() {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setForm({ ...form, lat: p.coords.latitude.toFixed(7), lng: p.coords.longitude.toFixed(7) });
        setMsg({ text: `Lokasi diambil (akurasi ±${Math.round(p.coords.accuracy)} m). Jangan lupa simpan.` });
        setLocating(false);
      },
      (e) => { setMsg({ err: true, text: e.message }); setLocating(false); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  async function save(e, extra = {}) {
    e?.preventDefault();
    try {
      await api(form.id ? `/admin/venues/${form.id}` : '/admin/venues', {
        method: form.id ? 'PUT' : 'POST', admin: true, body: { ...form, ...extra },
      });
      setMsg({ text: extra.rotate_secret ? 'Kode venue diganti.' : form.id ? 'Venue diperbarui.' : 'Venue ditambahkan.' });
      setForm(blank);
      load();
    } catch (e) { setMsg({ err: true, text: e.message }); }
  }

  async function del(v) {
    if (!window.confirm(`Hapus venue "${v.name}"?`)) return;
    try { await api(`/admin/venues/${v.id}`, { method: 'DELETE', admin: true }); load(); }
    catch (e) { setMsg({ err: true, text: e.message }); }
  }

  const edit = (v) => { setForm({ ...v }); setMsg(null); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Venue</h2>
          <p className="muted">Absen diterima bila peserta berada di dalam radius salah satu venue yang berlaku untuknya.
            Venue bisa dibatasi per sesi (menu Sesi) atau per orang (menu Peserta & Panitia).</p>
        </div>
      </div>

      <form className="card form form--grid" onSubmit={save}>
        <h3 className="span2">{form.id ? `Ubah venue: ${form.name}` : 'Tambah venue'}</h3>
        <label>Nama venue<input value={form.name} onChange={f('name')} placeholder="Hotel Savoy Homann – Ballroom" required /></label>
        <label>Alamat (opsional)<input value={form.address} onChange={f('address')} placeholder="Jl. Asia Afrika No. 112, Bandung" /></label>
        <label className="span2">Tempel koordinat dari Google Maps
          <input onChange={pasteCoords} placeholder="-6.921444, 107.607861  (klik kanan titik di Google Maps → klik koordinat)" />
        </label>
        <label>Latitude<input value={form.lat} onChange={f('lat')} required inputMode="decimal" /></label>
        <label>Longitude<input value={form.lng} onChange={f('lng')} required inputMode="decimal" /></label>
        <label>Radius absensi (meter)<input type="number" min="10" value={form.radius_m} onChange={f('radius_m')} /></label>
        <label className="check" style={{ alignSelf: 'end' }}>
          <input type="checkbox" checked={form.active} onChange={f('active')} />
          <span><b>Aktif</b> — venue bisa dipakai untuk absen</span>
        </label>
        <div className="row span2">
          <button type="button" className="btn" onClick={useMyLocation} disabled={locating}>
            <Icon name="crosshair" size={18} />{locating ? 'Mengambil lokasi…' : 'Pakai lokasi saya sekarang'}
          </button>
        </div>
        {validCoord(form.lat, form.lng) && (
          <div className="span2 form" style={{ gap: 6 }}>
            <b style={{ fontSize: 14 }}>Pratinjau titik venue</b>
            <span className="muted small">Pastikan pin tepat di gedung/ruangan acara. Radius absensi: {form.radius_m} m dari titik ini.</span>
            <MapEmbed lat={form.lat} lng={form.lng} height={300} />
          </div>
        )}
        {msg && <div className={`alert span2 ${msg.err ? 'alert--err' : 'alert--ok'}`}>{msg.text}</div>}
        <div className="row span2">
          <button className="btn btn--primary"><Icon name={form.id ? 'check' : 'plus'} size={18} />{form.id ? 'Simpan perubahan' : 'Tambah venue'}</button>
          {form.id && <button type="button" className="btn" onClick={() => setForm(blank)}>Batal</button>}
        </div>
      </form>

      <table className="table">
        <thead><tr><th>Venue</th><th>Koordinat</th><th>Radius</th><th>Dikunci</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {list.map((v) => (
            <tr key={v.id}>
              <td><b>{v.name}</b>{v.address && <div className="muted small">{v.address}</div>}</td>
              <td><button type="button" className="link-btn small" onClick={() => setMapPoint({
                lat: v.lat, lng: v.lng, title: v.name, rows: [['Alamat', v.address], ['Radius', `${v.radius_m} m`]],
              })}><Icon name="pin" size={14} />{Number(v.lat).toFixed(5)}, {Number(v.lng).toFixed(5)}</button></td>
              <td>{v.radius_m} m</td>
              <td className="small">{v.people_count} orang</td>
              <td><span className={`tag ${v.active ? 'tag--open' : 'tag--off'}`}>{v.active ? 'Aktif' : 'Nonaktif'}</span></td>
              <td><div className="row">
                <a className="btn btn--sm" href={`/admin/kode-venue?venue=${v.id}`} target="_blank" rel="noreferrer"><Icon name="monitor" size={15} />Layar kode</a>
                <button className="btn btn--sm" onClick={() => edit(v)}>Ubah</button>
                <button className="btn btn--sm btn--danger" onClick={() => del(v)}>Hapus</button>
              </div></td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={6} className="muted">Belum ada venue.</td></tr>}
        </tbody>
      </table>
      <MapModal point={mapPoint} onClose={() => setMapPoint(null)} />
    </>
  );
}
