import { personName } from '../../lib/personName.js';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { Spinner } from '../../components/Skeleton.jsx';

/** LO mengganti password akunnya sendiri */
export default function ChangePassword() {
  const { user } = useOutletContext() || {};
  const [f, setF] = useState({ old_password: '', new_password: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setMsg(null); };
  const mismatch = f.confirm && f.new_password !== f.confirm;
  const tooShort = f.new_password && f.new_password.length < 8;

  async function submit(e) {
    e.preventDefault();
    if (mismatch || tooShort) return;
    setBusy(true);
    try {
      await api('/admin/me/password', { method: 'POST', admin: true, body: { old_password: f.old_password, new_password: f.new_password } });
      setF({ old_password: '', new_password: '', confirm: '' });
      setMsg({ ok: true, text: 'Password berhasil diganti. Gunakan password baru saat login berikutnya.' });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally { setBusy(false); }
  }

  const type = show ? 'text' : 'password';
  return (
    <>
      <div className="page-head">
        <div><h2>Ganti Kata Sandi</h2>
          <p className="muted">Akun <b>{personName(user?.name)}</b>{user?.venue ? ` — ${user.venue.name}` : ''}</p></div>
      </div>
      <form className="card form" style={{ maxWidth: 480 }} onSubmit={submit}>
        <label>Kata sandi lama
          <input type={type} value={f.old_password} onChange={set('old_password')} required autoComplete="current-password" />
        </label>
        <label>Kata sandi baru
          <input type={type} value={f.new_password} onChange={set('new_password')} required minLength={8} autoComplete="new-password" />
          {tooShort && <small className="field-err">Minimal 8 karakter.</small>}
        </label>
        <label>Ulangi kata sandi baru
          <input type={type} value={f.confirm} onChange={set('confirm')} required autoComplete="new-password" />
          {mismatch && <small className="field-err">Kata sandi baru tidak cocok.</small>}
        </label>
        <label className="chip-check" style={{ width: 'fit-content' }}>
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Tampilkan kata sandi
        </label>
        {msg && <div className={`alert ${msg.ok ? 'alert--ok' : 'alert--err'}`}><Icon name={msg.ok ? 'check' : 'alert'} size={18} /><span>{msg.text}</span></div>}
        <button className="btn btn--primary" disabled={busy || mismatch || tooShort || !f.old_password || !f.confirm}>
          {busy ? <><Spinner /> Menyimpan…</> : <><Icon name="key" size={18} /> Simpan kata sandi baru</>}
        </button>
      </form>
    </>
  );
}
