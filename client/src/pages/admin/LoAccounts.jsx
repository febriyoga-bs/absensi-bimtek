import LoRepresentation from '../../components/LoRepresentation.jsx';
import { sortTableRows } from '../../lib/tableSort.js';
import { personName } from '../../lib/personName.js';
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
  const [loginFilter, setLoginFilter] = useState('all');
  const [venueFilter, setVenueFilter] = useState('');
  const [loginDate, setLoginDate] = useState('');
  const [sort, setSort] = useState({ column: null, direction: 'asc' });
  const changeSort = (column) => setSort((previous) => ({ column, direction: previous.column === column && previous.direction === 'asc' ? 'desc' : 'asc' }));
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
    if (!window.confirm(`Hapus akun LO "${personName(l.name)}" (${l.username})?`)) return;
    await api(`/admin/lo/${l.id}`, { method: 'DELETE', admin: true });
    load();
  }

  const loginUrl = `${window.location.origin}/admin/login`;
  const wibDate = (value) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value));
  const today = wibDate(Date.now());
  const filtered = list.filter((account) => {
    if (venueFilter && String(account.venue_id) !== venueFilter) return false;
    const last = account.last_login_at;
    if (loginFilter === 'never') return !last;
    if (loginFilter === 'ever') return !!last;
    if (loginFilter === 'today') return !!last && wibDate(last) === today;
    if (loginFilter === 'date') return !loginDate || (!!last && wibDate(last) === loginDate);
    return true;
  });
  const sorted = sortTableRows(filtered.map((account) => ({ account, sortValues: [
    personName(account.name), account.username, account.venue_name,
    account.last_login_at ? Date.parse(account.last_login_at) : null, account.active ? 1 : 0,
  ] })), sort.column, sort.direction).map(({ account }) => account);
  const copyText = (c) => `Login Dashboard LO — ${c.venue}\n${loginUrl}\nUsername: ${c.username}\nPassword: ${c.password}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Akun LO Venue</h2>
          <p className="muted">Akun LO bisa mencatat dan memverifikasi absensi, melihat rekap kehadiran, serta mengunduh CSV untuk venue yang ditugaskan.</p>
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
            <b><Icon name="check" size={18} /> Kredensial untuk {personName(shown.name)}</b>
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

      <div className="toolbar">
        <label>Venue
          <select value={venueFilter} onChange={(event) => setVenueFilter(event.target.value)}>
            <option value="">Semua venue</option>
            {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}{!venue.active ? ' (nonaktif)' : ''}</option>)}
          </select>
        </label>
        <label>Login terakhir
          <select value={loginFilter} onChange={(event) => setLoginFilter(event.target.value)}>
            <option value="all">Semua akun</option>
            <option value="never">Belum pernah login</option>
            <option value="ever">Sudah pernah login</option>
            <option value="today">Login terakhir hari ini (WIB)</option>
            <option value="date">Tanggal login terakhir (WIB)</option>
          </select>
        </label>
        {loginFilter === 'date' && <label>Tanggal (WIB)
          <input type="date" value={loginDate} onChange={(event) => setLoginDate(event.target.value)} />
        </label>}
        <button type="button" className="btn btn--sm" onClick={load}><Icon name="refresh" size={15} />Muat ulang</button>
        <button type="button" className="btn btn--sm" onClick={() => { setVenueFilter(''); setLoginFilter('all'); setLoginDate(''); setSort({ column: null, direction: 'asc' }); }}>Reset filter</button>
      </div>
      {loaded && <p className="muted small" role="status">Menampilkan {filtered.length} dari {list.length} akun LO. Filter menggunakan tanggal login terakhir dalam WIB.</p>}
      <table className="table stack-table" role="table" aria-label="Daftar akun LO">
        <thead><tr>{['Nama', 'Username', 'Venue', 'Login terakhir', 'Status'].map((label, column) =>
          <th key={label} scope="col" aria-sort={sort.column === column ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
            <button type="button" className="lo-sort-button" onClick={() => changeSort(column)}>{label}<span aria-hidden="true">{sort.column === column ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span></button>
          </th>)}<th scope="col">Tindakan</th></tr></thead>
        <tbody>
          {sorted.map((l) => (
            <tr key={l.id} role="row">
              <td role="cell"><b>{personName(l.name)}</b><LoRepresentation name={l.name}/></td>
              <td role="cell" data-label="Username"><code>{l.username}</code></td>
              <td role="cell" data-label="Venue"><span className="tag tag--venue">{l.venue_name}</span></td>
              <td role="cell" data-label="Login terakhir" className="small">{l.last_login_at ? fmtDT(l.last_login_at) : <span className="muted">Belum pernah</span>}</td>
              <td role="cell" data-label="Status"><span className={`tag ${l.active ? 'tag--open' : 'tag--off'}`}>{l.active ? 'Aktif' : 'Nonaktif'}</span></td>
              <td role="cell" className="stack-full"><div className="row">
                <button className="btn btn--sm" onClick={() => { setForm({ ...l, password: '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Ubah</button>
                <button className="btn btn--sm" onClick={() => toggle(l)}>{l.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
                <button className="btn btn--sm btn--danger" onClick={() => del(l)}>Hapus</button>
              </div></td>
            </tr>
          ))}
          {!loaded && <SkelRows rows={5} cols={6} />}
          {loaded && !filtered.length && <tr><td colSpan={6} className="muted">{list.length ? 'Tidak ada akun LO yang cocok dengan filter.' : 'Belum ada akun LO.'}</td></tr>}
        </tbody>
      </table>
      <p className="muted small">Link login LO: <code>{loginUrl}</code> → pilih tab <b>LO Venue</b>.</p>
    </>
  );
}
