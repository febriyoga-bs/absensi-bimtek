import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import fs from 'fs';
import { q, getSettings } from '../db.js';
import { ah, HttpError, venueCode } from '../util.js';
import {
  requireAdmin, requireSuper, signAdmin, checkAdminPassword, hashPassword, verifyPassword,
} from '../auth.js';
import { photoUrl } from '../storage.js';

const r = Router();

/**
 * Venue yang dibatasi untuk request ini:
 *  - LO   → selalu venue miliknya (tidak bisa diganti lewat query)
 *  - admin → venue_id dari query bila ada, selain itu null (semua venue)
 */
const scopeVenue = (req) => {
  if (req.user.role === 'lo') return req.user.venue;
  const v = Number(req.query.venue_id);
  return Number.isInteger(v) && v > 0 ? v : null;
};

/* ---------- Login (admin utama & LO venue) ---------- */
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, skipSuccessfulRequests: true,
  message: { error: 'Terlalu banyak percobaan login gagal. Coba lagi dalam 15 menit.' } });

r.post('/login', loginLimiter, ah(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!username) {
    if (!checkAdminPassword(password)) throw new HttpError(401, 'Password salah');
    return res.json({ token: signAdmin({ role: 'admin' }), user: { role: 'admin', name: 'Admin utama' } });
  }

  const { rows: [lo] } = await q(
    `SELECT l.*, v.name AS venue_name FROM lo_accounts l JOIN venues v ON v.id=l.venue_id
     WHERE lower(l.username)=lower($1)`, [username]);
  if (!lo || !verifyPassword(password, lo.password_hash)) throw new HttpError(401, 'Username atau password salah');
  if (!lo.active) throw new HttpError(403, 'Akun LO ini dinonaktifkan. Hubungi admin utama.');
  await q('UPDATE lo_accounts SET last_login_at=now() WHERE id=$1', [lo.id]);
  res.json({
    token: signAdmin({ role: 'lo', lo: lo.id, venue: lo.venue_id }),
    user: { role: 'lo', name: lo.name, venue: { id: lo.venue_id, name: lo.venue_name } },
  });
}));

r.use(requireAdmin);

/** Info akun yang sedang login (dipanggil saat dashboard dibuka; LO nonaktif langsung ditolak). */
r.get('/me', ah(async (req, res) => {
  if (req.user.role === 'admin') return res.json({ role: 'admin', name: 'Admin utama' });
  const { rows: [lo] } = await q(
    `SELECT l.name, l.active, v.id AS venue_id, v.name AS venue_name
     FROM lo_accounts l JOIN venues v ON v.id=l.venue_id WHERE l.id=$1`, [req.user.lo]);
  if (!lo || !lo.active) throw new HttpError(401, 'Akun LO tidak aktif. Silakan login ulang.');
  res.json({ role: 'lo', name: lo.name, venue: { id: lo.venue_id, name: lo.venue_name } });
}));

/* ---------- Pengaturan acara (admin utama) ---------- */
const publicSettings = ({ venue_secret, venue_name, venue_lat, venue_lng, radius_m, ...s }) => s;

r.get('/settings', requireSuper, ah(async (req, res) => res.json(publicSettings(await getSettings()))));

r.put('/settings', requireSuper, ah(async (req, res) => {
  const b = req.body || {};
  await q(
    `UPDATE settings SET event_name=$1, organizer=$2, event_dates=$3, max_accuracy_m=$4, require_venue_code=$5 WHERE id=1`,
    [String(b.event_name || '').trim() || 'BIMTEK Revitalisasi SD', String(b.organizer || '').trim(),
      String(b.event_dates || '').trim(), Math.max(5, Number(b.max_accuracy_m) || 100), !!b.require_venue_code]
  );
  res.json(publicSettings(await getSettings()));
}));

/* ---------- Venue ---------- */
const publicVenue = ({ code_secret, ...v }) => v;

r.get('/venues', ah(async (req, res) => {
  const lo = req.user.role === 'lo' ? req.user.venue : null;
  const { rows } = await q(
    `SELECT v.*,
       (SELECT count(*) FROM people p WHERE p.venue_id=v.id)::int AS people_count,
       (SELECT count(*) FROM lo_accounts l WHERE l.venue_id=v.id AND l.active)::int AS lo_count
     FROM venues v WHERE ($1::int IS NULL OR v.id=$1) ORDER BY v.active DESC, v.name`, [lo]);
  res.json(rows.map(publicVenue));
}));

function cleanVenue(b) {
  const v = {
    name: String(b.name || '').trim(),
    address: String(b.address || '').trim(),
    lat: Number(b.lat), lng: Number(b.lng),
    radius_m: Math.max(10, Math.round(Number(b.radius_m) || 150)),
    active: b.active !== false,
  };
  if (!v.name) throw new HttpError(400, 'Nama venue wajib diisi');
  if (b.lat === '' || b.lng === '' || !Number.isFinite(v.lat) || !Number.isFinite(v.lng) ||
      Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180) {
    throw new HttpError(400, 'Koordinat venue tidak valid');
  }
  return v;
}

r.post('/venues', requireSuper, ah(async (req, res) => {
  const v = cleanVenue(req.body || {});
  const { rows } = await q(
    'INSERT INTO venues (name, address, lat, lng, radius_m, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [v.name, v.address, v.lat, v.lng, v.radius_m, v.active]);
  res.json(publicVenue(rows[0]));
}));

r.put('/venues/:id', requireSuper, ah(async (req, res) => {
  const v = cleanVenue(req.body || {});
  const { rows } = await q(
    'UPDATE venues SET name=$1, address=$2, lat=$3, lng=$4, radius_m=$5, active=$6 WHERE id=$7 RETURNING *',
    [v.name, v.address, v.lat, v.lng, v.radius_m, v.active, req.params.id]);
  if (req.body?.rotate_secret) {
    await q('UPDATE venues SET code_secret=$1 WHERE id=$2', [crypto.randomBytes(20).toString('hex'), req.params.id]);
  }
  res.json(rows[0] && publicVenue(rows[0]));
}));

r.delete('/venues/:id', requireSuper, ah(async (req, res) => {
  const { rows: [used] } = await q('SELECT count(*)::int AS n FROM attendance WHERE venue_id=$1', [req.params.id]);
  if (used.n > 0) {
    throw new HttpError(400, `Venue sudah dipakai ${used.n} absensi. Nonaktifkan saja agar riwayatnya tetap tersimpan.`);
  }
  await q('UPDATE sessions SET venue_ids = array_remove(venue_ids, $1::int)', [req.params.id]);
  await q('DELETE FROM venues WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

/** Kode venue berputar untuk layar di tiap venue (LO hanya venue-nya sendiri) */
r.get('/venues/:id/code', ah(async (req, res) => {
  const id = Number(req.params.id);
  if (req.user.role === 'lo' && id !== req.user.venue) throw new HttpError(403, 'Bukan venue Anda');
  const { rows: [v] } = await q('SELECT id, name, address, code_secret FROM venues WHERE id=$1', [id]);
  if (!v) throw new HttpError(404, 'Venue tidak ditemukan');
  const step = 30;
  const now = Date.now();
  res.json({
    venue: { id: v.id, name: v.name, address: v.address },
    code: venueCode(v.code_secret, 0, step, now),
    expires_in: step - (Math.floor(now / 1000) % step),
  });
}));

/* ---------- Akun LO (admin utama) ---------- */
r.get('/lo', requireSuper, ah(async (req, res) => {
  const { rows } = await q(
    `SELECT l.id, l.name, l.username, l.venue_id, l.active, l.last_login_at, l.created_at, v.name AS venue_name
     FROM lo_accounts l JOIN venues v ON v.id=l.venue_id ORDER BY v.name, l.name`);
  res.json(rows);
}));

function cleanLo(b, { requirePassword }) {
  const o = {
    name: String(b.name || '').trim(),
    username: String(b.username || '').trim(),
    venue_id: Number(b.venue_id),
    active: b.active !== false,
    password: String(b.password || ''),
  };
  if (!o.name) throw new HttpError(400, 'Nama LO wajib diisi');
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(o.username)) {
    throw new HttpError(400, 'Username 3–32 karakter: huruf, angka, titik, minus, garis bawah');
  }
  if (!Number.isInteger(o.venue_id)) throw new HttpError(400, 'Pilih venue');
  if ((requirePassword || o.password) && o.password.length < 6) throw new HttpError(400, 'Password minimal 6 karakter');
  return o;
}

const uniqueUsername = (e) => {
  if (e.code === '23505') throw new HttpError(400, 'Username sudah dipakai');
  throw e;
};

r.post('/lo', requireSuper, ah(async (req, res) => {
  const o = cleanLo(req.body || {}, { requirePassword: true });
  const { rows } = await q(
    `INSERT INTO lo_accounts (name, username, password_hash, venue_id, active) VALUES ($1,$2,$3,$4,$5)
     RETURNING id, name, username, venue_id, active`,
    [o.name, o.username, hashPassword(o.password), o.venue_id, o.active]).catch(uniqueUsername);
  res.json(rows[0]);
}));

r.put('/lo/:id', requireSuper, ah(async (req, res) => {
  const o = cleanLo(req.body || {}, { requirePassword: false });
  const { rows } = await q(
    `UPDATE lo_accounts SET name=$1, username=$2, venue_id=$3, active=$4,
       password_hash = COALESCE($5, password_hash)
     WHERE id=$6 RETURNING id, name, username, venue_id, active`,
    [o.name, o.username, o.venue_id, o.active, o.password ? hashPassword(o.password) : null, req.params.id]
  ).catch(uniqueUsername);
  res.json(rows[0]);
}));

r.delete('/lo/:id', requireSuper, ah(async (req, res) => {
  await q('DELETE FROM lo_accounts WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

/* ---------- Peserta & Panitia (admin utama) ---------- */
r.get('/people', requireSuper, ah(async (req, res) => {
  const role = ['peserta', 'panitia'].includes(req.query.role) ? req.query.role : null;
  const { rows } = await q(
    `SELECT p.*, v.name AS venue_name FROM people p LEFT JOIN venues v ON v.id=p.venue_id
     WHERE ($1::text IS NULL OR p.role=$1)
       AND ($2::text = '' OR p.name ILIKE '%'||$2||'%' OR p.code ILIKE '%'||$2||'%' OR p.institution ILIKE '%'||$2||'%')
     ORDER BY p.role, p.name`,
    [role, String(req.query.q || '')]
  );
  res.json(rows);
}));

function cleanPerson(p, defRole) {
  const role = String(p.role || defRole || '').toLowerCase().trim();
  const venueId = p.venue_id === '' || p.venue_id == null ? null : Number(p.venue_id);
  const out = {
    code: String(p.code || '').trim(),
    name: String(p.name || '').trim(),
    role,
    institution: String(p.institution || '').trim() || null,
    position: String(p.position || '').trim() || null,
    phone: String(p.phone || '').trim() || null,
    venue_id: Number.isInteger(venueId) ? venueId : null,
  };
  if (!out.code || !out.name) throw new HttpError(400, 'Kode dan nama wajib diisi');
  if (!['peserta', 'panitia'].includes(role)) throw new HttpError(400, `Peran "${role}" tidak valid (peserta/panitia)`);
  return out;
}

const upsertPerson = (p) =>
  q(
    `INSERT INTO people (code, name, role, institution, position, phone, venue_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (lower(code)) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role,
       institution=EXCLUDED.institution, position=EXCLUDED.position, phone=EXCLUDED.phone, venue_id=EXCLUDED.venue_id
     RETURNING *`,
    [p.code, p.name, p.role, p.institution, p.position, p.phone, p.venue_id]
  );

r.post('/people', requireSuper, ah(async (req, res) => {
  const { rows } = await upsertPerson(cleanPerson(req.body || {}));
  res.json(rows[0]);
}));

r.put('/people/:id', requireSuper, ah(async (req, res) => {
  const p = cleanPerson(req.body || {});
  const { rows } = await q(
    `UPDATE people SET code=$1, name=$2, role=$3, institution=$4, position=$5, phone=$6, venue_id=$7 WHERE id=$8 RETURNING *`,
    [p.code, p.name, p.role, p.institution, p.position, p.phone, p.venue_id, req.params.id]
  );
  res.json(rows[0]);
}));

r.delete('/people/:id', requireSuper, ah(async (req, res) => {
  await q('DELETE FROM people WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

/** CSV: kode,nama,peran,instansi,jabatan,telepon,venue (header opsional; pemisah , atau ;) */
function parseCsv(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const split = (line) => {
    const out = []; let cur = ''; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
      else if (c === sep && !quoted) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  let rows = lines.map(split);
  if (/^(kode.*|code|nik|nip|no\.?|nomor.*)$/i.test(rows[0][0])) rows = rows.slice(1);
  return rows.map(([code, name, role, institution, position, phone, venue]) =>
    ({ code, name, role, institution, position, phone, venue }));
}

r.post('/people/import', requireSuper, ah(async (req, res) => {
  const list = parseCsv(req.body?.csv);
  const { rows: venues } = await q('SELECT id, name FROM venues');
  const byName = new Map(venues.map((v) => [v.name.trim().toLowerCase(), v.id]));
  const errors = [];
  let ok = 0;
  for (const [i, raw] of list.entries()) {
    try {
      let venue_id = null;
      if (raw.venue) {
        venue_id = byName.get(raw.venue.toLowerCase());
        if (!venue_id) throw new HttpError(400, `venue "${raw.venue}" tidak ditemukan`);
      }
      await upsertPerson(cleanPerson({ ...raw, venue_id }, req.body?.role));
      ok++;
    } catch (e) { errors.push(`Baris ${i + 1}: ${e.message}`); }
  }
  res.json({ imported: ok, errors });
}));

/* ---------- Sesi ---------- */
/**
 * Rekap per sesi. Untuk LO (atau admin yang memfilter venue) semua angka dihitung
 * hanya untuk venue tsb:
 *  - sesi yang ditampilkan: sesi untuk semua venue, atau yang mencakup venue ini
 *  - "expected": orang yang ditetapkan ke venue ini + orang tanpa venue (bebas)
 */
r.get('/sessions', ah(async (req, res) => {
  const v = scopeVenue(req);
  const { rows } = await q(
    `SELECT s.*,
       (SELECT count(*) FROM people p WHERE (s.role='semua' OR p.role=s.role)
          AND (cardinality(COALESCE(s.venue_ids,'{}'))=0 OR p.venue_id IS NULL OR p.venue_id = ANY(s.venue_ids))
          AND ($1::int IS NULL OR p.venue_id IS NULL OR p.venue_id=$1))::int AS expected,
       (SELECT count(*) FROM attendance a WHERE a.session_id=s.id AND a.status='valid' AND ($1::int IS NULL OR a.venue_id=$1))::int AS valid,
       (SELECT count(*) FROM attendance a WHERE a.session_id=s.id AND a.status='review' AND ($1::int IS NULL OR a.venue_id=$1))::int AS review,
       (SELECT count(*) FROM attendance a WHERE a.session_id=s.id AND a.status='ditolak' AND ($1::int IS NULL OR a.venue_id=$1))::int AS rejected,
       (SELECT count(*) FROM attempt_logs l WHERE l.session_id=s.id AND ($1::int IS NULL OR l.venue_id=$1))::int AS blocked,
       (SELECT COALESCE(json_agg(x ORDER BY x.name), '[]') FROM (
          SELECT v.name, count(*)::int AS n FROM attendance a JOIN venues v ON v.id=a.venue_id
          WHERE a.session_id=s.id AND a.status<>'ditolak' AND ($1::int IS NULL OR a.venue_id=$1) GROUP BY v.name) x) AS by_venue,
       now() BETWEEN s.starts_at AND s.ends_at AS is_open
     FROM sessions s
     WHERE $1::int IS NULL OR cardinality(COALESCE(s.venue_ids,'{}'))=0 OR $1 = ANY(s.venue_ids)
     ORDER BY starts_at`,
    [v]
  );
  res.json(rows);
}));

function cleanSession(b) {
  const ids = Array.isArray(b.venue_ids) ? b.venue_ids.map(Number).filter(Number.isInteger) : [];
  const s = {
    name: String(b.name || '').trim(),
    role: b.role, type: b.type || 'masuk',
    starts_at: new Date(b.starts_at), ends_at: new Date(b.ends_at),
    venue_ids: ids.length ? ids : null,
  };
  if (!s.name) throw new HttpError(400, 'Nama sesi wajib diisi');
  if (!['peserta', 'panitia', 'semua'].includes(s.role)) throw new HttpError(400, 'Peran sesi tidak valid');
  if (!['masuk', 'pulang'].includes(s.type)) throw new HttpError(400, 'Jenis sesi tidak valid');
  if (isNaN(s.starts_at) || isNaN(s.ends_at) || s.ends_at <= s.starts_at) {
    throw new HttpError(400, 'Waktu mulai/selesai tidak valid');
  }
  return s;
}

r.post('/sessions', requireSuper, ah(async (req, res) => {
  const s = cleanSession(req.body || {});
  const { rows } = await q(
    'INSERT INTO sessions (name, role, type, starts_at, ends_at, venue_ids) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [s.name, s.role, s.type, s.starts_at, s.ends_at, s.venue_ids]);
  res.json(rows[0]);
}));

r.put('/sessions/:id', requireSuper, ah(async (req, res) => {
  const s = cleanSession(req.body || {});
  const { rows } = await q(
    'UPDATE sessions SET name=$1, role=$2, type=$3, starts_at=$4, ends_at=$5, venue_ids=$6 WHERE id=$7 RETURNING *',
    [s.name, s.role, s.type, s.starts_at, s.ends_at, s.venue_ids, req.params.id]);
  res.json(rows[0]);
}));

r.delete('/sessions/:id', requireSuper, ah(async (req, res) => {
  await q('DELETE FROM sessions WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

/* ---------- Absensi ---------- */
/** Daftar absen per sesi, dengan halaman (default 48 per halaman) agar ringan. */
r.get('/attendance', ah(async (req, res) => {
  const v = scopeVenue(req);
  const status = ['valid', 'review', 'ditolak'].includes(req.query.status) ? req.query.status : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 48, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const where = `a.session_id=$1 AND ($2::int IS NULL OR a.venue_id=$2)`;
  const [{ rows }, { rows: [c] }] = await Promise.all([
    q(
      `SELECT a.id, a.status, a.risk_score, a.flags, a.lat, a.lng, a.accuracy_m, a.distance_m,
              a.created_at, a.device_id, a.user_agent, a.ip, a.photo_path, a.venue_id,
              p.name, p.code, p.role, p.institution, p.position, v.name AS venue_name
       FROM attendance a JOIN people p ON p.id=a.person_id LEFT JOIN venues v ON v.id=a.venue_id
       WHERE ${where} AND ($3::text IS NULL OR a.status=$3)
       ORDER BY a.risk_score DESC, a.created_at DESC
       LIMIT $4 OFFSET $5`,
      [req.query.session_id, v, status, limit, offset]
    ),
    q(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE a.status='valid')::int AS valid,
              count(*) FILTER (WHERE a.status='review')::int AS review,
              count(*) FILTER (WHERE a.status='ditolak')::int AS ditolak
       FROM attendance a WHERE ${where}`,
      [req.query.session_id, v]
    ),
  ]);
  // Signed URL R2 hanya untuk foto di halaman ini (bukan semua foto sesi)
  const out = await Promise.all(rows.map(async ({ photo_path, ...x }) => ({ ...x, photo_url: await photoUrl(photo_path) })));
  res.json({
    rows: out,
    total: status ? c[status] : c.total,
    counts: c,
    limit,
    offset,
  });
}));

async function assertOwnAttendance(req, id) {
  if (req.user.role !== 'lo') return;
  const { rows: [a] } = await q('SELECT venue_id FROM attendance WHERE id=$1', [id]);
  if (!a || a.venue_id !== req.user.venue) throw new HttpError(403, 'Absensi ini bukan dari venue Anda');
}

r.patch('/attendance/:id', ah(async (req, res) => {
  if (!['valid', 'review', 'ditolak'].includes(req.body?.status)) throw new HttpError(400, 'Status tidak valid');
  await assertOwnAttendance(req, req.params.id);
  const { rows } = await q('UPDATE attendance SET status=$1 WHERE id=$2 RETURNING id, status', [req.body.status, req.params.id]);
  res.json(rows[0]);
}));

r.get('/attempts', ah(async (req, res) => {
  const v = scopeVenue(req);
  const { rows } = await q(
    `SELECT l.id, l.reasons, l.lat, l.lng, l.accuracy_m, l.distance_m, l.created_at,
            p.name, p.code, p.role, v.name AS venue_name
     FROM attempt_logs l LEFT JOIN people p ON p.id=l.person_id LEFT JOIN venues v ON v.id=l.venue_id
     WHERE l.session_id=$1 AND ($2::int IS NULL OR l.venue_id=$2)
     ORDER BY l.created_at DESC LIMIT 500`, [req.query.session_id, v]);
  res.json(rows);
}));

r.get('/photo/:id', ah(async (req, res) => {
  await assertOwnAttendance(req, req.params.id);
  const { rows } = await q('SELECT photo_path FROM attendance WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).end();
  const url = await photoUrl(rows[0].photo_path, 600);
  if (url) return res.redirect(302, url);
  if (!fs.existsSync(rows[0].photo_path)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(rows[0].photo_path);
}));

/**
 * Rekap CSV: semua orang yang wajib hadir di sesi + status kehadirannya.
 * LO / filter venue: orang yang ditetapkan ke venue ini, orang tanpa venue,
 * dan siapa pun yang absen di venue ini.
 */
r.get('/export', ah(async (req, res) => {
  const v = scopeVenue(req);
  const { rows: [s] } = await q('SELECT * FROM sessions WHERE id=$1', [req.query.session_id]);
  if (!s) throw new HttpError(404, 'Sesi tidak ditemukan');
  const { rows } = await q(
    `SELECT p.code, p.name, p.role, p.institution, p.position, pv.name AS assigned_venue,
            a.status, a.created_at, av.name AS venue, a.lat, a.lng, a.distance_m, a.accuracy_m, a.flags
     FROM people p
     LEFT JOIN venues pv ON pv.id=p.venue_id
     LEFT JOIN attendance a ON a.person_id=p.id AND a.session_id=$1
     LEFT JOIN venues av ON av.id=a.venue_id
     WHERE ($2='semua' OR p.role=$2)
       AND (cardinality(COALESCE($3::int[],'{}'))=0 OR p.venue_id IS NULL OR p.venue_id = ANY($3::int[]))
       AND ($4::int IS NULL
            OR a.venue_id = $4
            OR (a.id IS NULL AND (p.venue_id IS NULL OR p.venue_id = $4)))
     ORDER BY p.role, p.name`,
    [s.id, s.role, s.venue_ids, v]
  );
  let venueName = '';
  if (v) venueName = (await q('SELECT name FROM venues WHERE id=$1', [v])).rows[0]?.name || '';
  const esc = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const fmt = (d) => d ? new Date(d).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '';
  const header = ['Kode', 'Nama', 'Peran', 'Instansi', 'Jabatan', 'Venue Ditetapkan', 'Kehadiran', 'Status Verifikasi',
    'Waktu (WIB)', 'Venue Absen', 'Latitude', 'Longitude', 'Jarak (m)', 'Akurasi (m)', 'Catatan'];
  const lines = rows.map((x) => [
    x.code, x.name, x.role, x.institution, x.position, x.assigned_venue || 'Semua',
    x.status && x.status !== 'ditolak' ? 'Hadir' : 'Tidak hadir', x.status || '',
    fmt(x.created_at), x.venue || '', x.lat ?? '', x.lng ?? '',
    x.distance_m != null ? Math.round(x.distance_m) : '', x.accuracy_m != null ? Math.round(x.accuracy_m) : '',
    (x.flags || []).map((f) => f.detail).join('; '),
  ].map(esc).join(','));
  const name = `absensi-${s.name}${venueName ? '-' + venueName : ''}`.replace(/[^\w-]+/g, '_') + '.csv';
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${name}"`);
  res.send('﻿' + [header.map(esc).join(','), ...lines].join('\r\n'));
}));

export default r;
