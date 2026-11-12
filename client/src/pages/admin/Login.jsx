import { useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { api, adminToken, adminUser } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import FontIcon from '../../components/FontIcon.jsx';
import BrandMark from '../../components/BrandMark.jsx';

export default function Login() {
  const [mode, setMode] = useState('lo'); // 'lo' | 'admin'
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const { state, search } = useLocation();

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body = mode === 'lo' ? { username, password: pw } : { password: pw };
      const { token, user } = await api('/admin/login', { method: 'POST', body });
      adminToken.set(token);
      adminUser.set(user);
      const next = state?.next ?? new URLSearchParams(search).get('next');
      nav(typeof next === 'string' && /^\/admin(?:\/|\?|$)/.test(next) ? next : '/admin/pelaporan', { replace: true });
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const switchMode = (m) => { setMode(m); setErr(null); setPw(''); setShowPassword(false); };

  return (
    <div className="login">
      <form className="card form" onSubmit={submit}>
        <span className="brand"><BrandMark size={44} /><span className="brand__text">Dashboard LO<small>BIMTEK Revitalisasi SD</small></span></span>
        <div className="seg" role="tablist">
          <button type="button" role="tab" className={mode === 'lo' ? 'on' : ''} onClick={() => switchMode('lo')}>
            <Icon name="pin" size={16} />LO Venue
          </button>
          <button type="button" role="tab" className={mode === 'admin' ? 'on' : ''} onClick={() => switchMode('admin')}>
            <Icon name="settings" size={16} />Admin utama
          </button>
        </div>
        {mode === 'lo' && (
          <label>Username LO
            <span className="input-icon"><Icon name="users" /><input value={username} onChange={(e) => setUsername(e.target.value)}
              autoFocus autoCapitalize="none" autoComplete="username" placeholder="mis. LO1.Febriyoga" /></span>
          </label>
        )}
        <div className="login-password">
          <label htmlFor="login-password">Kata sandi</label>
          <span className="input-icon">
            <Icon name="key" />
            <input id="login-password" type={showPassword ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)}
              autoFocus={mode === 'admin'} autoComplete="current-password" autoCapitalize="none" spellCheck={false} />
            <button type="button" className="login-password__toggle" aria-controls="login-password"
              aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
              onClick={() => setShowPassword((visible) => !visible)}>
              <FontIcon name={showPassword ? 'eye-slash' : 'eye'} />
            </button>
          </span>
        </div>
        {err && <div className="alert alert--err"><Icon name="alert" size={18} />{err}</div>}
        <button className="btn btn--primary btn--lg" disabled={busy || !pw || (mode === 'lo' && !username.trim())}>
          {busy ? 'Masuk…' : 'Masuk'}
        </button>
        <p className="muted small" style={{ margin: 0, textAlign: 'center' }}>
          {mode === 'lo' ? 'Masuk untuk melihat binaan, memantau pelaporan, dan mencatat kehadiran di venue Anda.' : 'Masuk untuk mengelola kegiatan, akun LO, dan rekap lintas venue.'}
        </p>
        <Link to="/" className="link">← Kembali ke beranda</Link>
      </form>
    </div>
  );
}
