import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { q } from './db.js';

const SECRET = () => {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error('JWT_SECRET wajib diisi (min. 16 karakter)');
  return s;
};

/**
 * Token login dashboard.
 *  - Super admin : { adm: true, role: 'admin' }                      → akses penuh
 *  - LO venue    : { adm: true, role: 'lo', lo: id, venue: venueId }  → hanya data venue-nya
 */
export const signAdmin = (payload = { role: 'admin' }) =>
  jwt.sign({ adm: true, ...payload }, SECRET(), { expiresIn: '12h' });

export async function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  // ?t= dipakai untuk <img src> dan tautan unduh CSV
  const queryAllowed = req.method === 'GET' && (/^\/photo\/\d+$/.test(req.path) || req.path === '/export');
  const token = header.startsWith('Bearer ') ? header.slice(7) : queryAllowed ? req.query.t : undefined;
  let p;
  try {
    p = jwt.verify(String(token || ''), SECRET(), { algorithms: ['HS256'] });
    if (p.adm !== true || !['admin', 'lo'].includes(p.role)) throw new Error();
    if (p.role === 'lo' && (!Number.isSafeInteger(p.lo) || !Number.isSafeInteger(p.venue) || p.lo < 1 || p.venue < 1)) throw new Error();
  } catch {
    return res.status(401).json({ error: 'Sesi login berakhir, silakan login ulang' });
  }
  if (p.role === 'lo') {
    try {
      const { rows: [account] } = await q('SELECT active, venue_id FROM lo_accounts WHERE id=$1', [p.lo]);
      if (!account?.active || account.venue_id !== p.venue) {
        return res.status(401).json({ error: 'Akun atau penempatan venue berubah. Silakan login ulang.' });
      }
    } catch (e) {
      return next(e);
    }
  }
  req.user = { role: p.role === 'lo' ? 'lo' : 'admin', lo: p.lo ?? null, venue: p.venue ?? null };
  next();
}

/** Hanya super admin (kelola peserta, sesi, venue, pengaturan, akun LO). */
export function requireSuper(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Menu ini hanya untuk admin utama' });
  next();
}

export function requireLo(req, res, next) {
  if (req.user?.role !== 'lo') return res.status(403).json({ error: 'Pencatatan absensi ini hanya tersedia untuk akun LO.' });
  next();
}

export function checkAdminPassword(pw) {
  const a = Buffer.from(String(pw || ''));
  const b = Buffer.from(String(process.env.ADMIN_PASSWORD || ''));
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- Password akun LO (scrypt, tanpa dependensi tambahan) ---------- */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !/^[a-f0-9]{32}$/.test(saltHex || '') || !/^[a-f0-9]{64}$/.test(hashHex || '') || String(pw).length > 1024) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

/** Token absensi sekali pakai, mengikat orang + sesi + nonce, berlaku singkat. */
export function signChallenge(personId, sessionId, nonce, loAccount) {
  const ttl = Number(process.env.CHALLENGE_TTL || 300);
  return jwt.sign({
    p: personId, s: sessionId, n: nonce,
    ...(loAccount && { lo: loAccount.lo, venue: loAccount.venue }),
  }, SECRET(), { expiresIn: ttl });
}

export function verifyChallenge(token) {
  try {
    const p = jwt.verify(String(token || ''), SECRET(), { algorithms: ['HS256'] });
    return p.adm ? null : p; // token login admin tidak boleh dipakai sebagai token absen
  } catch {
    return null;
  }
}
