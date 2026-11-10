import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { fmtDT } from './shared.js';
import { Skel, SkelRows, SkelLines, Spinner } from '../../components/Skeleton.jsx';

const blank = { id: null, name: '', username: '', password: '', venue_id: '', active: true };

/** Password acak mudah dibaca (tanpa huruf/angka yang mirip seperti 0/O, 1/l). */
function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => chars[n % chars.length]).join('');
}

export default function LoAccounts() {
  const [list, setList] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [venues, setVenues] = useState([]);
  const [form, setForm] = useState(blank);
  const [msg, setMsg] = useState(null);
  const [shown, setShown] = useState(null); // kredensial yang baru dibuat → ditampilkan sekali

  const load = () => api('/admin/lo', { admin: true }).then(setList).finally(() => setLoaded(true));
  useEffect(() => { load(); api('/admin/venues', { admin: true }).then(setVenues); }, []);
  const f = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    setMsg(null);
    try {
      const body = { ...form, venue_id: Number(form.venue_id) };
      await api(form.id ? `/admin/lo/${form.id}` : '/admin/lo', { method: form.id ? 'PUT' : 'POST', admin: true, body });
      const venueName = venues.find((v) => v.id === Number(form.venue_id))?.name;
      if (form.password) setShown({ name: form.name, username: form.username, password: form.password, venue: venueName });
      setMsg({ text: form.id ? 'Akun LO diperbarui.' : 'Akun LO dibuat.' });
      setForm(blank);
      load();
    } catch (e) { setMsg({ err: true, text: e.message }); }
  }

  async function toggle(l) {
    await api(`/admin/lo/${l.id}`, { method: 'PUT', admin: true, body: { ...l, active: !l.active, password: '' } });
    load();
  }

  async function del(l) {
    if (!window.confirm(`Hapus akun LO "${l.name}" (${l.username})?`)) return;
    await api(`/admin/lo/${l.id}`, { method: 'DELETE', admin: true });
    load();
  }

  const loginUrl = `${window.location.origin}/admin/login`;
  const copyText = (c) => `Login Dashboard LO — ${c.venue}\n${loginUrl}\nUsername: ${c.username}\nPassword: ${c.password}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Akun LO Venue</h2>
          <p className="muted">Akun LO digunakan untuk mencatat dan memverifikasi absensi, melihat rekap kehadiran, mengunduh CSV, dan membuka layar kode di venue yang ditugaskan.</p>
        </div>
      </div>

      {!venues.length && (
        <div className="alert alert--warn" style={{ marginBottom: 16 }}><Icon name="alert" size={18} />
          <span>Belum ada venue. <Link to="/admin/venue">Tambah venue dulu</Link>.</span>
        </div>
      )}

      {shown && (
        <div className="card cred">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b><Icon name="check" size={18} /> Kredensial untuk {shown.name}</b>
            <button className="btn btn--sm" onClick={() => setShown(null)}><Icon name="x" size={14} />Tutup</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Password tidak bisa dilihat lagi setelah ditutup. Salin dan kirim ke LO sekarang.</p>
          <pre>{copyText(shown)}</pre>
          <button className="btn btn--sm" onClick={() => navigator.clipboard?.writeText(copyText(shown))}><Icon name="list" size={15} />Salin</button>
        </div>
      )}

      <form className="card form form--grid" onSubmit={save}>
        <h3 className="span2">{form.id ? `Ubah akun: ${form.name}` : 'Tambah akun LO'}</h3>
        <label>Nama LO<input value={form.name} onChange={f('name')} placeholder="Andi Pratama" required /></label>
        <label>Venue<select value={form.venue_id} onChange={f('venue_id')} required>
          <option value="">Pilih venue…</option>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.name}{!v.active ? ' (nonaktif)' : ''}</option>)}
        </select></label>
        <label>Username<input value={form.username} onChange={f('username')} placeholder="LO1.Febriyoga" autoCapitalize="none" required /></label>
        <label>{form.id ? 'Password baru (kosongkan bila tidak diganti)' : 'Password'}
          <span className="row" style={{ flexWrap: 'nowrap' }}>
            <input value={form.password} onChange={f('password')} placeholder={form.id ? '••••••' : 'min. 6 karakter'} required={!form.id} autoComplete="new-password" />
            <button type="button" className="btn btn--sm" onClick={() => setForm({ ...form, password: randomPassword() })}>Acak</button>
          </span>
        </label>
        <label className="check span2">
          <input type="checkbox" checked={form.active} onChange={f('active')} />
          <span><b>Aktif</b> — LO bisa login</span>
        </label>
        {msg && <div className={`alert span2 ${msg.err ? 'alert--err' : 'alert--ok'}`}>{msg.text}</div>}
        <div className="row span2">
          <button className="btn btn--primary" disabled={!venues.length}><Icon name={form.id ? 'check' : 'plus'} size={18} />{form.id ? 'Simpan' : 'Tambah akun'}</button>
          {form.id && <button type="button" className="btn" onClick={() => setForm(blank)}>Batal</button>}
        </div>
      </form>

      <table className="table">
        <thead><tr><th>Nama</th><th>Username</th><th>Venue</th><th>Login terakhir</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {list.map((l) => (
            <tr key={l.id}>
              <td><b>{l.name}</b></td>
              <td><code>{l.username}</code></td>
              <td><span className="tag tag--venue">{l.venue_name}</span></td>
              <td className="small">{l.last_login_at ? fmtDT(l.last_login_at) : <span className="muted">Belum pernah</span>}</td>
              <td><span className={`tag ${l.active ? 'tag--open' : 'tag--off'}`}>{l.active ? 'Aktif' : 'Nonaktif'}</span></td>
              <td><div className="row">
                <button className="btn btn--sm" onClick={() => { setForm({ ...l, password: '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Ubah</button>
                <button className="btn btn--sm" onClick={() => toggle(l)}>{l.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
                <button className="btn btn--sm btn--danger" onClick={() => del(l)}>Hapus</button>
              </div></td>
            </tr>
          ))}
          {!loaded && <SkelRows rows={5} cols={6} />}
          {loaded && !list.length && <tr><td colSpan={6} className="muted">Belum ada akun LO.</td></tr>}
        </tbody>
      </table>
      <p className="muted small">Link login LO: <code>{loginUrl}</code> → pilih tab <b>LO Venue</b>.</p>
    </>
  );
}
