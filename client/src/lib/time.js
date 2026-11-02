import { useEffect, useState } from 'react';

const TZ = 'Asia/Jakarta';

/** Jam realtime, berdetik tiap `ms`. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export const fmtClock = (d) =>
  new Date(d).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ });
export const fmtHM = (d) =>
  new Date(d).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
export const fmtDate = (d) =>
  new Date(d).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
export const fmtFull = (d) => `${fmtDate(d)}, ${fmtClock(d)} WIB`;

/** "2 jam 5 menit" / "12 menit" / "45 detik" */
export function fmtRemaining(ms) {
  if (ms <= 0) return '0 detik';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h) return `${h} jam ${m} menit`;
  if (m) return `${m} menit`;
  return `${s} detik`;
}

/** Label hari relatif: "Hari ini" / "Besok" / tanggal */
export function dayLabel(d) {
  const key = (x) => new Date(x).toLocaleDateString('en-CA', { timeZone: TZ });
  const today = key(new Date());
  const tomorrow = key(Date.now() + 86_400_000);
  const k = key(d);
  return k === today ? 'Hari ini' : k === tomorrow ? 'Besok' : new Date(d).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
}

export const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
