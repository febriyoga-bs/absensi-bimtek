import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, adminToken } from '../../api.js';
import Icon from '../../components/Icon.jsx';

export default function Login() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { token } = await api('/admin/login', { method: 'POST', body: { password: pw } });
      adminToken.set(token);
      nav('/admin');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="login">
      <form className="card form" onSubmit={submit}>
        <span className="brand"><span className="brand__mark"><Icon name="school" size={20} /></span>Admin Absensi BIMTEK</span>
        <label>Password admin
          <span className="input-icon"><Icon name="key" /><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></span>
        </label>
        {err && <div className="alert alert--err"><Icon name="alert" size={18} />{err}</div>}
        <button className="btn btn--primary btn--lg" disabled={busy || !pw}>{busy ? 'Masuk…' : 'Masuk'}</button>
        <Link to="/" className="link">← Kembali ke beranda</Link>
      </form>
    </div>
  );
}
