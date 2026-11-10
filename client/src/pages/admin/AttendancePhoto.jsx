import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminUrl } from '../../api.js';

export default function AttendancePhoto() {
  const { id } = useParams();
  const [failed, setFailed] = useState('');
  return (
    <>
      <div className="page-head">
        <div><h2>Foto Absensi</h2><p className="muted">Dokumentasi yang tersimpan pada catatan absensi.</p></div>
        <Link className="btn" to="/admin/absensi">Kembali ke Verifikasi Absensi</Link>
      </div>
      {!/^\d+$/.test(id) || failed === id
        ? <p className="alert alert--warn" role="status">Foto tidak tersedia atau akun Anda tidak memiliki akses ke venue ini.</p>
        : <img className="attendance-photo" src={adminUrl(`/photo/${id}`)} alt="Foto absensi"
          referrerPolicy="no-referrer" onError={() => setFailed(id)} />}
    </>
  );
}
