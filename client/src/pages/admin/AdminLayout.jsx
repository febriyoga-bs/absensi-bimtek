import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, adminToken, adminUser } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import BrandMark from '../../components/BrandMark.jsx';

// lo: true → menu juga tampil untuk LO venue
const NAV = [
  { to: '/admin', end: true, icon: 'chart', label: 'Rekap Kehadiran', lo: true },
  { to: '/admin/pendampingan', end: true, icon: 'chart', label: 'Rekap Pendampingan', lo: true },
  { to: '/admin/pendampingan/saya', end: true, icon: 'list', label: 'Daftar Pendampingan', lo: true, loOnly: true },
  { to: '/admin/scan', icon: 'users', label: 'Absenkan Peserta', lo: true },
  { to: '/admin/absen-saya', end: true, icon: 'idcard', label: 'Absen Saya', lo: true, loOnly: true },
  { to: '/admin/absensi', icon: 'list', label: 'Verifikasi Absensi', lo: true },
  { to: '/admin/sesi', icon: 'calendar', label: 'Sesi & Jadwal' },
  { to: '/admin/orang', icon: 'users', label: 'Peserta & Panitia' },
  { to: '/admin/venue', icon: 'pin', label: 'Venue' },
  { to: '/admin/lo', icon: 'idcard', label: 'Akun LO' },
  { to: '/admin/pengaturan', icon: 'settings', label: 'Pengaturan' },
  { to: '/admin/password', icon: 'key', label: 'Ganti Password', lo: true, loOnly: true },
];

export default function AdminLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const [user, setUser] = useState(adminUser.get());
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef(null);

  // Segarkan info akun (LO yang dinonaktifkan langsung keluar)
  useEffect(() => {
    if (!adminToken.get()) return;
    api('/admin/me', { admin: true }).then((u) => { adminUser.set(u); setUser(u); }).catch(() => {});
  }, []);
  useEffect(() => { setMenuOpen(false); }, [loc.pathname]);

  if (!adminToken.get()) return <Navigate to="/admin/login" replace />;

  const lo = user?.role === 'lo';
  const items = NAV.filter((n) => (lo ? n.lo : !n.loOnly));
  // LO yang membuka menu admin utama lewat URL → kembalikan ke Rekap
  if (lo && !items.some((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)))) {
    return <Navigate to="/admin" replace />;
  }

  return (
    <div className="admin">
      <aside className="admin__nav" onKeyDown={(e) => {
        if (menuOpen && e.key === 'Escape') {
          setMenuOpen(false);
          menuButton.current?.focus();
        }
      }}>
        <div className="admin__nav-head">
          <div className="admin__brand">
            <BrandMark size={38} />
            <span>{lo ? 'Dashboard LO' : 'Admin BIMTEK'}<small>BIMTEK Revitalisasi SD</small></span>
          </div>
          <button ref={menuButton} className="admin__menu-toggle" type="button" aria-expanded={menuOpen}
            aria-controls="admin-menu" onClick={() => setMenuOpen(!menuOpen)}>
            <Icon name={menuOpen ? 'x' : 'list'} size={20} />{menuOpen ? 'Tutup' : 'Menu'}
          </button>
        </div>
        <nav id="admin-menu" aria-label="Menu dashboard" className={`admin__menu${menuOpen ? ' is-open' : ''}`}>
          {user && (
            <div className="admin__user">
              <span className={`tag ${lo ? 'tag--venue' : 'tag--type'}`}>{lo ? 'LO' : 'Admin utama'}</span>
              <b>{user.name}</b>
              {lo && <small><Icon name="pin" size={13} /> {user.venue?.name}</small>}
            </div>
          )}
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setMenuOpen(false)}>
              <Icon name={n.icon} size={18} />{n.label}
            </NavLink>
          ))}
          <button className="link" onClick={() => { adminToken.clear(); nav('/admin/login'); }}>
            <Icon name="logout" size={18} /> Keluar
          </button>
        </nav>
      </aside>
      <section className="admin__main"><Outlet context={{ user, lo }} /></section>
    </div>
  );
}
