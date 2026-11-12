import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, adminToken, adminUser } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import FontIcon from '../../components/FontIcon.jsx';
import BrandMark from '../../components/BrandMark.jsx';
import { dashboardMenu } from '../../lib/dashboardMenu.js';

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

  if (!adminToken.get()) return <Navigate to="/admin/login" state={{ next: loc.pathname + loc.search }} replace />;

  const lo = user?.role === 'lo';
  const items = dashboardMenu.filter((n) => (lo ? n.lo : !n.loOnly));
  if (loc.pathname === '/admin/pendampingan/saya') return <Navigate to="/admin/pendampingan?cakupan=saya" replace />;
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
              <FontIcon name={n.icon} />{(!lo && n.adminLabel) || n.label}
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
