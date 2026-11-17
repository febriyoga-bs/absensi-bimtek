import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { q, rawPool } from './db.js';
import { eventId, eventContext } from './eventContext.js';
import { identityGrants } from './loIdentity.js';

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
  jwt.sign({ adm: true, ...(payload.role === 'lo' ? payload : { event: eventId(), ...payload }) }, SECRET(), { expiresIn: '12h' });

export async function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  // ?t= dipakai untuk <img src> dan tautan unduh CSV
  const queryAllowed = req.method === 'GET' && (/^\/photo\/\d+$/.test(req.path) || /^\/lo\/attendance\/\d+\/photo$/.test(req.path) || req.path === '/export');
  const token = header.startsWith('Bearer ') ? header.slice(7) : queryAllowed ? req.query.t : undefined;
  let p;
  try {
    p = jwt.verify(String(token || ''), SECRET(), { algorithms: ['HS256'] });
    if (p.adm !== true || !['admin', 'lo'].includes(p.role)) throw new Error();
    if (p.role === 'lo' && (!p.username || typeof p.username !== 'string')) throw new Error();
    if (p.role === 'lo' && (!Array.isArray(p.accounts) || !p.accounts.length
      || !p.accounts.every((grant) => Number.isSafeInteger(grant.event) && grant.event > 0 && Number.isSafeInteger(grant.id) && grant.id > 0))) throw new Error();
  } catch {
    return res.status(401).json({ error: 'Sesi login berakhir, silakan login ulang' });
  }
  if (p.role === 'lo') {
    try {
      p.accounts=await identityGrants(p.accounts);
      if (Array.isArray(p.accounts) && !p.accounts.some((account) => account.event === eventId())) {
        const readable = req.method==='GET' && ['/me','/reporting','/venue-attendance','/sessions'].includes(req.path);
        if (!readable) return res.status(403).json({ error: 'Akun Anda tidak memiliki penugasan untuk kegiatan ini.' });
        const {rows:events} = await rawPool.query('SELECT * FROM public.bimtek_events ORDER BY id');
        let identity;
        for (const grant of p.accounts) {
          const source = events.find((event) => event.id===grant.event);
          if (!source) continue;
          const result = await eventContext.run(source, () => q('SELECT name FROM lo_accounts WHERE id=$1 AND active', [grant.id]));
          if (result.rows[0]) { identity=result.rows[0]; break; }
        }
        if (!identity) return res.status(401).json({error:'Akun LO tidak aktif. Silakan login ulang.'});
        req.user={role:'lo',lo:null,venue:null,name:identity.name,no_assignment:true,events:events.map((event)=>event.id)};
        return next();
      }
      const grant=p.accounts.find((account)=>account.event===eventId());
      const { rows: [account] } = await q('SELECT id, name, active, venue_id FROM lo_accounts WHERE id=$1', [grant.id]);
      if (!account?.active) {
        return res.status(401).json({ error: 'Akun atau penempatan venue berubah. Silakan login ulang.' });
      }
      if (Array.isArray(p.accounts) && !p.accounts.some((grant) => grant.event === eventId() && grant.id === account.id)) {
        return res.status(403).json({ error: 'Penugasan akun berubah. Silakan login ulang.' });
      }
      p.lo = account.id; p.venue = account.venue_id; p.name=account.name;
    } catch (e) {
      return next(e);
    }
  }
  req.user = { role: p.role === 'lo' ? 'lo' : 'admin', lo: p.lo ?? null, venue: p.venue ?? null, name:p.name,
    ...(Array.isArray(p.accounts) && { events: p.accounts.map((account) => account.event) }) };
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
    p: personId, s: sessionId, n: nonce, event: eventId(),
    ...(loAccount && { lo: loAccount.lo, venue: loAccount.venue }),
  }, SECRET(), { expiresIn: ttl });
}

export function verifyChallenge(token) {
  try {
    const p = jwt.verify(String(token || ''), SECRET(), { algorithms: ['HS256'] });
    return p.adm || (p.event ?? 3) !== eventId() ? null : p;
  } catch {
    return null;
  }
}
