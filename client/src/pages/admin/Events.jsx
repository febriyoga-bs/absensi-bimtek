import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { selectedEvent } from '../../event.js';

const labels = { draft: 'Persiapan', active: 'Aktif', archived: 'Arsip' };
export default function Events() {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/events').then(setEvents).catch((e) => setError(e.message)); }, []);
  async function update(id, status) {
    setBusy(true); setError('');
    try {
      await api(`/events/${id}/status`, { admin: true, method: 'PUT', body: { status } });
      window.location.reload();
    } catch (e) { setError(e.message); setBusy(false); }
  }
  return <div>
    <div className="page-head"><div><h2>Kegiatan BIMTEK</h2><p className="muted">Kelola tahap kegiatan tanpa menimpa riwayat tahap sebelumnya.</p></div></div>
    <p className="alert">Kegiatan yang sedang dibuka: <b>{selectedEvent()?.name}</b>. Sebelum impor, pastikan tab kegiatan yang dipilih sudah benar.</p>
    {error && <p className="alert alert--err" role="alert">{error}</p>}
    <div className="grid">{events.map((event) => <section key={event.id} className="card" style={{ padding: 20, marginBottom: 16 }}>
      <h3>{event.name}</h3><p><span className="tag">{labels[event.status]}</span></p>
      <p>Peserta, venue, akun dan penugasan LO, sesi, absensi, pelaporan, serta kedatangan disimpan terpisah untuk kegiatan ini.</p>
      {event.status !== 'active' && <div className="row">
        <button className="btn btn--primary" disabled={busy} onClick={() => update(event.id, 'active')}>Aktifkan {event.name}</button>
        {event.status === 'archived' && <button className="btn" disabled={busy} onClick={() => update(event.id, 'draft')}>Buka untuk persiapan / koreksi</button>}
      </div>}
      {event.status !== 'active' && <p className="muted small">Mengaktifkan kegiatan ini otomatis mengarsipkan kegiatan aktif sebelumnya. Arsip tetap bisa dilihat dan diunduh.</p>}
    </section>)}</div>
    <section className="card" style={{ padding: 20 }}>
      <h3>Menyiapkan Tahap 4</h3>
      <ol><li>Pilih tab BIMTEK Tahap 4.</li><li>Isi venue dan periksa koordinat serta radiusnya.</li><li>Impor peserta melalui Peserta &amp; Panitia. Nama venue harus cocok.</li><li>Siapkan akun LO, pemetaan pendampingan, dan sesi resmi sesuai data Tahap 4.</li><li>Periksa hasil impor dan uji alur absensi sebelum mengaktifkan kegiatan.</li></ol>
      <p className="muted small">Data Tahap 3 tidak disalin otomatis. Kode peserta dan username yang sama boleh digunakan di tahap berbeda. Saat LO mengganti kegiatan, LO perlu login untuk kegiatan tujuan.</p>
    </section>
  </div>;
}
