import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const SECRET = () => {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error('JWT_SECRET wajib diisi (min. 16 karakter)');
  return s;
};

export const signAdmin = () => jwt.sign({ adm: true }, SECRET(), { expiresIn: '12h' });

export function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  // ?t= dipakai untuk <img src> dan tautan unduh CSV
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.t;
  try {
    const p = jwt.verify(String(token || ''), SECRET());
    if (!p.adm) throw new Error();
    next();
  } catch {
    res.status(401).json({ error: 'Sesi admin berakhir, silakan login ulang' });
  }
}

export function checkAdminPassword(pw) {
  const a = Buffer.from(String(pw || ''));
  const b = Buffer.from(String(process.env.ADMIN_PASSWORD || ''));
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Token absensi sekali pakai, mengikat orang + sesi + nonce, berlaku singkat. */
export function signChallenge(personId, sessionId, nonce) {
  const ttl = Number(process.env.CHALLENGE_TTL || 300);
  return jwt.sign({ p: personId, s: sessionId, n: nonce }, SECRET(), { expiresIn: ttl });
}

export function verifyChallenge(token) {
  try {
    return jwt.verify(String(token || ''), SECRET());
  } catch {
    return null;
  }
}
