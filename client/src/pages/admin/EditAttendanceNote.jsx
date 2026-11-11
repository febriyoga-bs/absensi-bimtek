import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';

export default function EditAttendanceNote({ target, onClose, onSaved }) {
  const dialog = useRef(null);
  const [note, setNote] = useState(target.participant_note || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current.showModal(); }, []);

  async function save(event) {
    event.preventDefault();
    if (busy || !note.trim()) return;
    setBusy(true);
    setError('');
    try {
      const updated = await api(`/admin/attendance/${target.id}/note`, {
        method: 'PATCH', admin: true, body: { note: note.trim() },
      });
      onSaved(updated);
      onClose();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="assignment-dialog" aria-labelledby="edit-note-title"
    onClose={onClose} onCancel={(event) => { if (busy) event.preventDefault(); }}>
    <header><h3 id="edit-note-title">Ubah catatan</h3></header>
    <p><strong>{target.name}</strong></p>
    <form className="form" onSubmit={save}>
      <label>Catatan kendala sekolah dalam pelaporan progres 50%
        <textarea autoFocus rows={5} maxLength={1000} required disabled={busy}
          value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <span className="muted small">{note.length}/1.000 karakter</span>
      {error && <p className="alert alert--err" role="alert">{error}</p>}
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button>
        <button className="btn btn--primary" disabled={busy || !note.trim()}>{busy ? 'Menyimpan…' : 'Simpan catatan'}</button>
      </div>
    </form>
  </dialog>;
}
