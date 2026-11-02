import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import Icon from '../../components/Icon.jsx';

const blank = { id: null, code: '', name: '', role: 'peserta', institution: '', position: '', phone: '', venue_id: '' };

export default function People() {
  const [role, setRole] = useState('peserta');
  const [search, setSearch] = useState('');
  const [list, setList] = useState([]);
  const [venues, setVenues] = useState([]);
  const [form, setForm] = useState(blank);
  const [csv, setCsv] = useState('');
  const [msg, setMsg] = useState(null);

  useEffect(() => { api('/admin/venues', { admin: true }).then(setVenues); }, []);
  const load = () => api(`/admin/people?role=${role}&q=${encodeURIComponent(search)}`, { admin: true }).then(setList);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [role, search]);
  const f = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    try {
      await api(form.id ? `/admin/people/${form.id}` : '/admin/people', { method: form.id ? 'PUT' : 'POST', admin: true, body: form });
      setForm({ ...blank, role });
      setMsg(null);
      load();
    } catch (e) { setMsg({ err: true, text: e.message }); }
  }

  async function importCsv() {
    const r = await api('/admin/people/import', { method: 'POST', admin: true, body: { csv, role } });
    setMsg({ err: r.errors.length > 0, text: `${r.imported} data diimpor.${r.errors.length ? ' ' + r.errors.join(' | ') : ''}` });
    if (!r.errors.length) setCsv('');
    load();
  }

  async function del(p) {
    if (!window.confirm(`Hapus ${p.name}?`)) return;
    await api(`/admin/people/${p.id}`, { method: 'DELETE', admin: true });
    load();
  }

  const switchRole = (r) => { setRole(r); setForm({ ...blank, role: r }); };

  return (
    <>
      <div className="page-head"><div><h2>Peserta & Panitia</h2>
        <p className="muted">Kode dipakai untuk login absen. Venue boleh dikosongkan agar bisa absen di venue mana saja.</p></div></div>
      <div className="tabs">
        <button className={role === 'peserta' ? 'on' : ''} onClick={() => switchRole('peserta')}>Peserta</button>
        <button className={role === 'panitia' ? 'on' : ''} onClick={() => switchRole('panitia')}>Panitia</button>
      </div>

      <div className="two-col">
        <form className="card form form--grid" onSubmit={save}>
          <h3 className="span2">{form.id ? 'Ubah data' : `Tambah ${role}`}</h3>
          <label>Kode<input value={form.code} onChange={f('code')} required /></label>
          <label>Nama lengkap<input value={form.name} onChange={f('name')} required /></label>
          <label>Instansi / Sekolah<input value={form.institution || ''} onChange={f('institution')} /></label>
          <label>Jabatan<input value={form.position || ''} onChange={f('position')} /></label>
          <label>No. HP<input value={form.phone || ''} onChange={f('phone')} /></label>
          <label>Peran<select value={form.role} onChange={f('role')}>
            <option value="peserta">Peserta</option><option value="panitia">Panitia</option>
          </select></label>
          <label className="span2">Venue<select value={form.venue_id ?? ''} onChange={f('venue_id')}>
            <option value="">Semua venue (bebas)</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></label>
          <div className="row span2">
            <button className="btn btn--primary"><Icon name={form.id ? 'check' : 'plus'} size={18} />{form.id ? 'Simpan' : 'Tambah'}</button>
            {form.id && <button type="button" className="btn" onClick={() => setForm({ ...blank, role })}>Batal</button>}
          </div>
        </form>

        <div className="card form">
          <h3>Impor CSV / tempel dari Excel</h3>
          <p className="muted small" style={{ margin: 0 }}>Kolom: <code>kode, nama, peran, instansi, jabatan, telepon, venue</code>.
            Peran kosong = "{role}". Venue diisi <b>nama venue persis</b> atau kosong (bebas). Pemisah koma / titik-koma.</p>
          <textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)}
            placeholder={`kode,nama,peran,instansi,jabatan,telepon,venue\nP-001,Siti Aminah,peserta,SDN 1 Contoh,Kepala Sekolah,0812...,${venues[0]?.name || 'Hotel A'}`} />
          <button className="btn" onClick={importCsv} disabled={!csv.trim()}><Icon name="download" size={18} />Impor</button>
        </div>
      </div>
      {msg && <div className={`alert ${msg.err ? 'alert--err' : 'alert--ok'}`} style={{ marginBottom: 12 }}>{msg.text}</div>}

      <div className="toolbar">
        <input placeholder="Cari nama / kode / instansi" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="muted">{list.length} orang</span>
      </div>
      <table className="table">
        <thead><tr><th>Kode</th><th>Nama</th><th>Instansi</th><th>Jabatan</th><th>Venue</th><th></th></tr></thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id}>
              <td><code>{p.code}</code></td><td><b>{p.name}</b>{p.phone && <div className="muted small">{p.phone}</div>}</td>
              <td>{p.institution}</td><td>{p.position}</td>
              <td>{p.venue_name ? <span className="tag tag--venue">{p.venue_name}</span> : <span className="muted small">Semua</span>}</td>
              <td><div className="row">
                <button className="btn btn--sm" onClick={() => setForm({ ...p, venue_id: p.venue_id ?? '' })}>Ubah</button>
                <button className="btn btn--sm btn--danger" onClick={() => del(p)}>Hapus</button>
              </div></td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={6} className="muted">Belum ada data.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
