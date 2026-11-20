import { personName } from '../../lib/personName.js';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, adminToken, adminUser } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import FontIcon from '../../components/FontIcon.jsx';
import BrandMark from '../../components/BrandMark.jsx';
import { menuForEvent } from '../../lib/dashboardMenu.js';
import EventTabs from '../../components/EventTabs.jsx';
import { selectedEvent } from '../../event.js';
import { useEvents } from '../../components/EventScope.jsx';

export default function AdminLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const eventScope = useEvents();
  const pks = eventScope?.event.id === 5;
  const home = pks ? '/admin/pks' : '/admin/pelaporan';
  const activeAttendancePage = loc.pathname === '/admin/absen-saya' || loc.pathname.startsWith('/admin/scan');
  const needsActiveEvent = activeAttendancePage && !pks && eventScope?.event.status !== 'active';
  const activeEvent = eventScope?.events.find((event) => event.status === 'active');
  const [user, setUser] = useState(adminUser.get());
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef(null);

  // Segarkan info akun (LO yang dinonaktifkan langsung keluar)
  useEffect(() => {
    if (!adminToken.get()) return;
    api('/admin/me', { admin: true }).then((u) => { adminUser.set(u); setUser(u); }).catch(() => {});
  }, []);
  useEffect(() => { setMenuOpen(false); }, [loc.pathname]);
  useEffect(() => {
    if (needsActiveEvent && activeEvent) eventScope.change(String(activeEvent.id));
  }, [needsActiveEvent, activeEvent?.id]);

  if (!adminToken.get()) return <Navigate to="/admin/login" state={{ next: loc.pathname + loc.search }} replace />;

  const lo = user?.role === 'lo';
  const items = menuForEvent(pks).filter((n) => (lo ? n.lo && (!user.no_assignment
    || [home,'/admin/rekap-absensi'].includes(n.to)) : !n.loOnly));
  if (['/admin', '/admin/', '/admin/pendampingan', '/admin/pendampingan/saya'].includes(loc.pathname)) {
    return <Navigate to={home} replace />;
  }
  if (pks && loc.pathname === '/admin/pelaporan') return <Navigate to={home} replace />;
  if (user?.scope === 'pks' && !items.some(n => n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to))) return <Navigate to={home} replace />;
  // LO yang membuka menu admin utama lewat URL → kembalikan ke Pantau Pelaporan
  if (lo && !items.some((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)))) {
    return <Navigate to={home} replace />;
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
            <span>{lo ? 'Dashboard LO' : pks ? 'Admin PKS' : 'Admin BIMTEK'}<small>{pks ? 'Satdik Aman Bencana · 23–28 November 2026' : 'BIMTEK Revitalisasi SD'}</small></span>
          </div>
          <button ref={menuButton} className="admin__menu-toggle" type="button" aria-expanded={menuOpen}
            aria-controls="admin-menu" onClick={() => setMenuOpen(!menuOpen)}>
            <Icon name={menuOpen ? 'x' : 'list'} size={20} />{menuOpen ? 'Tutup' : 'Menu'}
          </button>
        </div>
        <nav id="admin-menu" aria-label="Menu dashboard" className={`admin__menu${menuOpen ? ' is-open' : ''}`}>
          {user && (
            <div className="admin__user">
              <span className={`tag ${lo ? 'tag--venue' : 'tag--type'}`}>{lo ? 'LO' : pks ? 'Admin PKS' : 'Admin utama'}</span>
              <b>{personName(user.name)}</b>
              {lo && <small><Icon name="pin" size={13} /> {user.venue?.name}</small>}
            </div>
          )}
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setMenuOpen(false)}>
              <FontIcon name={n.icon} />{(!lo && n.adminLabel) || n.label}
            </NavLink>
          ))}
          {!lo && !pks && <NavLink to="/#public-verval" onClick={() => setMenuOpen(false)}>
            <FontIcon name="map-location-dot" /> Peta Revitalisasi
          </NavLink>}
          <button className="link" onClick={() => { adminToken.clear(); nav('/admin/login'); }}>
            <Icon name="logout" size={18} /> Keluar
          </button>
        </nav>
      </aside>
      <section className="admin__main">
        {loc.pathname !== '/admin/pelaporan' && user?.scope !== 'pks' && <EventTabs activeOnly={activeAttendancePage} />}
        {!activeAttendancePage && selectedEvent()?.status === 'archived' && <p className="alert">{selectedEvent().name} sudah diarsipkan. Data hanya dapat dilihat dan diunduh.</p>}
        {needsActiveEvent ? <p role="status">{activeEvent ? 'Membuka tahap aktif…' : 'Belum ada tahap aktif untuk pencatatan absensi.'}</p> : <Outlet context={{ user, lo }} />}
      </section>
    </div>
  );
}
