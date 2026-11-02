import crypto from 'crypto';

// Bungkus handler async agar error diteruskan ke error handler Express 4
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Jarak dua koordinat dalam meter (haversine). */
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Kode venue berputar (mirip TOTP): 6 digit, berganti tiap `step` detik.
 * Ditampilkan panitia di layar/proyektor lokasi acara — hanya orang yang
 * benar-benar hadir yang bisa melihatnya, sehingga fake GPS saja tidak cukup.
 */
export function venueCode(secret, offset = 0, step = 30, now = Date.now()) {
  const counter = Math.floor(now / 1000 / step) + offset;
  const h = crypto.createHmac('sha1', secret).update(String(counter)).digest();
  const o = h[h.length - 1] & 0xf;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

export function verifyVenueCode(secret, code) {
  const c = String(code || '').replace(/\D/g, '');
  // terima jendela sekarang & sebelumnya (toleransi ±30 dtk)
  return c.length === 6 && [0, -1].some((o) => venueCode(secret, o) === c);
}

export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}
