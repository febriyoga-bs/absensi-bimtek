import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { fmtDT, toLocalInput } from './shared.js';

const blank = () => {
  const s = new Date(); s.setMinutes(0, 0, 0);
  const e = new Date(s); e.setHours(e.getHours() + 1);
  return { id: null, name: '', role: 'peserta', type: '', starts_at: toLocalInput(s), ends_at: toLocalInput(e), venue_ids: [] };
};

export default function Sessions() {
  const [list, setList] = useState([]);
  const [venues, setVenues] = useState([]);
  const [form, setForm] = useState(blank());
  const [err, setErr] = useState(null);
  const typeRef = useRef(null);
  // "Sesi Absensi N - " lalu kursor langsung di akhir untuk mengetik keterangan
  const pickPrefix = (n) => {
    const prefix = `Sesi Absensi ${n} - `;
    const rest = form.type.replace(/^Sesi Absensi \d+ - ?/i, '');
    setForm({ ...form, type: prefix + rest });
    requestAnimationFrame(() => { const el = typeRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  };
  const activeN = (form.type.match(/^Sesi Absensi (\d+) - /i) || [])[1];
  const load = () => api('/admin/sessions', { admin: true }).then(setList);
  useEffect(() => { load(); api('/admin/venues', { admin: true }).then(setVenues); }, []);
  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const venueName = (id) => venues.find((v) => v.id === id)?.name || `#${id}`;

  function toggleVenue(id) {
    const ids = form.venue_ids || [];
    setForm({ ...form, venue_ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
  }

  async function save(e) {
    e.preventDefault();
    setErr(null);
    try {
      const body = { ...form, starts_at: new Date(form.starts_at).toISOString(), ends_at: new Date(form.ends_at).toISOString() };
      await api(form.id ? `/admin/sessions/${form.id}` : '/admin/sessions', { method: form.id ? 'PUT' : 'POST', admin: true, body });
      setForm(blank());
      load();
    } catch (e) { setErr(e.message); }
  }

  async function del(s) {
    if (!window.confirm(`Hapus sesi "${s.name}" beserta seluruh data absensinya?`)) return;
    await api(`/admin/sessions/${s.id}`, { method: 'DELETE', admin: true });
    load();
  }

  return (
    <>
      <div className="page-head">
        <div><h2>Sesi & Jadwal</h2>
          <p className="muted">Absensi hanya bisa dilakukan saat sesi dibuka. Buat sesi terpisah untuk peserta dan panitia bila jamnya berbeda.</p></div>
      </div>
      <form className="card form form--grid" onSubmit={save}>
        <h3 className="span2">{form.id ? 'Ubah sesi' : 'Tambah sesi'}</h3>
        <label className="span2">Nama sesi<input value={form.name} onChange={f('name')} placeholder="Hari 1 – Absen Pagi" required /></label>
        <label>Untuk<select value={form.role} onChange={f('role')}>
          <option value="peserta">Peserta</option><option value="panitia">Panitia</option><option value="semua">Semua</option>
        </select></label>
        <label>Jenis absen
          <input ref={typeRef} value={form.type} onChange={f('type')} maxLength={80} required
            placeholder="Sesi Absensi 1 - Pembukaan" />
          <span className="chips" style={{ marginTop: 2 }}>
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" className={`chip-btn ${activeN === String(n) ? 'on' : ''}`} onClick={() => pickPrefix(n)}>
                Sesi Absensi {n} - …
              </button>
            ))}
          </span>
          <small className="muted" style={{ fontWeight: 400 }}>Klik salah satu, lalu ketik keterangannya (mis. Pembukaan, Materi 2, Penutupan). Bisa juga diketik bebas.</small>
        </label>
        <label>Dibuka<input type="datetime-local" value={form.starts_at} onChange={f('starts_at')} required /></label>
        <label>Ditutup<input type="datetime-local" value={form.ends_at} onChange={f('ends_at')} required /></label>
        <div className="span2 form" style={{ gap: 8 }}>
          <b style={{ fontSize: 14 }}>Venue yang berlaku</b>
          <span className="muted small">Kosongkan = semua venue aktif. Centang bila sesi ini hanya untuk venue tertentu.</span>
          <div className="chips">
            {venues.map((v) => (
              <label key={v.id} className="chip-check">
                <input type="checkbox" checked={(form.venue_ids || []).includes(v.id)} onChange={() => toggleVenue(v.id)} />
                {v.name}{!v.active && ' (nonaktif)'}
              </label>
            ))}
            {!venues.length && <span className="muted small">Belum ada venue.</span>}
          </div>
        </div>
        {err && <div className="alert alert--err span2">{err}</div>}
        <div className="row span2">
          <button className="btn btn--primary"><Icon name={form.id ? 'check' : 'plus'} size={18} />{form.id ? 'Simpan perubahan' : 'Tambah sesi'}</button>
          {form.id && <button type="button" className="btn" onClick={() => setForm(blank())}>Batal</button>}
        </div>
      </form>
      <table className="table">
        <thead><tr><th>Sesi</th><th>Untuk</th><th>Waktu (WIB)</th><th>Venue</th><th>Hadir</th><th></th></tr></thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td><b>{s.name}</b> <span className="tag tag--type">{s.type}</span> {s.is_open && <span className="tag tag--open">● Dibuka</span>}</td>
              <td><span className={`tag tag--${s.role}`}>{s.role}</span></td>
              <td className="small">{fmtDT(s.starts_at)} – {fmtDT(s.ends_at)}</td>
              <td className="small">{s.venue_ids?.length ? s.venue_ids.map(venueName).join(', ') : <span className="muted">Semua venue</span>}</td>
              <td>{s.valid + s.review}/{s.expected}</td>
              <td><div className="row">
                <button className="btn btn--sm" onClick={() => setForm({ ...s, venue_ids: s.venue_ids || [], starts_at: toLocalInput(s.starts_at), ends_at: toLocalInput(s.ends_at) })}>Ubah</button>
                <button className="btn btn--sm btn--danger" onClick={() => del(s)}>Hapus</button>
              </div></td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={6} className="muted">Belum ada sesi.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
