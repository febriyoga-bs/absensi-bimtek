import { createContext, useContext, useEffect, useState } from 'react';
import { setSelectedEvent } from '../event.js';
import { adminToken, adminUser } from '../api.js';

const EventsContext = createContext(null);
export const useEvents = () => useContext(EventsContext);
export default function EventScope({ children }) {
  const [events, setEvents] = useState(null);
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    fetch('/api/events').then(async (response) => {
      if (!response.ok) throw new Error('Daftar kegiatan belum dapat dimuat. Pastikan migrasi database sudah dijalankan.');
      return response.json();
    }).then(async (rows) => {
      if (!live) return;
      const user = adminUser.get();
      if (adminToken.get() && user?.role === 'lo' && Array.isArray(user.events)
        && window.location.pathname.startsWith('/admin/') && window.location.pathname !== '/admin/login') {
        rows = rows.filter((row) => user.events.some((event) => event.id === row.id));
      }
      const explicit = new URLSearchParams(window.location.search).get('event');
      let saved;
      try { saved = localStorage.getItem('bimtek_event'); } catch { /* unavailable */ }
      const qr = window.location.pathname.match(/^\/qr\/([a-f0-9]{32})$/);
      let cardEvent;
      if (qr && !explicit) {
        const response = await fetch(`/api/events/resolve-qr/${qr[1]}`);
        if (response.ok) cardEvent = await response.json();
      }
      if (!live) return;
      const chosen = cardEvent || rows.find((row) => String(row.id) === (explicit || saved)) || rows.find((row) => row.status === 'active') || rows[0];
      if (!chosen) throw new Error('Belum ada kegiatan yang tersedia.');
      try { localStorage.setItem('bimtek_event', String(chosen.id)); } catch { /* unavailable */ }
      setSelectedEvent(chosen); setEvent(chosen); setEvents(rows); setError('');
    }).catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [revision]);
  function change(id) {
    if (String(event.id) === id) return;
    try { localStorage.setItem('bimtek_event', id); } catch { /* URL preserves selection */ }
    const url = new URL(window.location.href);
    // Session, venue, recorder and pagination belong to the previous activity.
    url.search = '';
    if (/^\/admin\/absensi\/foto\//.test(url.pathname)) url.pathname = '/admin/absensi';
    url.searchParams.set('event', id);
    window.location.assign(url.href);
  }
  if (error) return <main className="panel" style={{ margin: 24 }}><p role="alert">{error}</p><button className="btn" onClick={() => setRevision((n) => n + 1)}>Coba lagi</button></main>;
  if (!events) return <p role="status" style={{ padding: 24 }}>Memuat kegiatan…</p>;
  return <EventsContext.Provider value={{ events, event, change }}>{children}</EventsContext.Provider>;
}
