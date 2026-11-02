import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { adminToken } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import BrandMark from '../../components/BrandMark.jsx';

const NAV = [
  { to: '/admin', end: true, icon: 'chart', label: 'Rekap' },
  { to: '/admin/absensi', icon: 'list', label: 'Verifikasi Absensi' },
  { to: '/admin/sesi', icon: 'calendar', label: 'Sesi & Jadwal' },
  { to: '/admin/orang', icon: 'users', label: 'Peserta & Panitia' },
  { to: '/admin/venue', icon: 'pin', label: 'Venue' },
  { to: '/admin/pengaturan', icon: 'settings', label: 'Pengaturan' },
];

export default function AdminLayout() {
  const nav = useNavigate();
  if (!adminToken.get()) return <Navigate to="/admin/login" replace />;
  return (
    <div className="admin">
      <aside className="admin__nav">
        <div className="admin__brand">
          <BrandMark size={38} />
          <span>Admin Absensi<small>BIMTEK Revitalisasi SD</small></span>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} size={18} />{n.label}</NavLink>
        ))}
        <NavLink to="/admin/kode-venue" target="_blank"><Icon name="monitor" size={18} />Layar Kode Venue ↗</NavLink>
        <button className="link" onClick={() => { adminToken.clear(); nav('/admin/login'); }}>
          <Icon name="logout" size={18} /> Keluar
        </button>
      </aside>
      <section className="admin__main"><Outlet /></section>
    </div>
  );
}
