import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import fs from 'fs';
import { q, getSettings } from '../db.js';
import { ah, HttpError, venueCode, clientIp } from '../util.js';
import {
  requireAdmin, requireSuper, signAdmin, checkAdminPassword, hashPassword, verifyPassword,
} from '../auth.js';
import { photoUrl } from '../storage.js';
import { parsePeople, EXTRA_FIELDS } from '../peopleImport.js';

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

/* ---------- Ganti password akun sendiri (LO) ---------- */
r.post('/me/password', loginLimiter, ah(async (req, res) => {
  if (req.user.role !== 'lo') {
    throw new HttpError(400, 'Password admin utama diatur lewat variabel ADMIN_PASSWORD di Vercel, bukan dari sini.');
  }
  const oldPw = String(req.body?.old_password || '');
  const newPw = String(req.body?.new_password || '');
  if (newPw.length < 8) throw new HttpError(400, 'Password baru minimal 8 karakter.');
  if (newPw.length > 72) throw new HttpError(400, 'Password baru terlalu panjang (maks. 72 karakter).');
  if (newPw === oldPw) throw new HttpError(400, 'Password baru harus berbeda dari password lama.');
  const { rows: [lo] } = await q('SELECT id, password_hash, active FROM lo_accounts WHERE id=$1', [req.user.lo]);
  if (!lo || !lo.active) throw new HttpError(401, 'Akun LO tidak aktif. Silakan login ulang.');
  if (!verifyPassword(oldPw, lo.password_hash)) throw new HttpError(400, 'Password lama salah.');
  await q('UPDATE lo_accounts SET password_hash=$1 WHERE id=$2', [hashPassword(newPw), lo.id]);
  res.json({ ok: true });
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
       AND ($2::text = '' OR p.name ILIKE '%'||$2||'%' OR p.code ILIKE '%'||$2||'%' OR p.institution ILIKE '%'||$2||'%'
            OR p.npsn ILIKE '%'||$2||'%' OR p.kab_kota ILIKE '%'||$2||'%' OR p.ruangan ILIKE '%'||$2||'%')
     ORDER BY p.role, p.name`,
    [role, String(req.query.q || '')]
  );
  res.json(rows);
}));

const BASE_FIELDS = ['code', 'name', 'role', 'institution', 'position', 'phone', 'venue_id'];
const PERSON_FIELDS = [...BASE_FIELDS, ...EXTRA_FIELDS];

function cleanPerson(p, defRole) {
  const role = String(p.role || defRole || '').toLowerCase().trim();
  const venueId = p.venue_id === '' || p.venue_id == null ? null : Number(p.venue_id);
  const txt = (x, max = 2000) => String(x ?? '').trim().slice(0, max) || null;
  const out = {
    code: String(p.code || '').trim(),
    name: String(p.name || '').trim(),
    role,
    institution: txt(p.institution, 4000),
    position: txt(p.position),
    phone: txt(p.phone),
    venue_id: Number.isInteger(venueId) ? venueId : null,
  };
  for (const f of EXTRA_FIELDS) out[f] = txt(p[f], 4000);
  if (!out.code || !out.name) throw new HttpError(400, 'Kode dan nama wajib diisi');
  if (!['peserta', 'panitia'].includes(role)) throw new HttpError(400, `Peran "${role}" tidak valid (peserta/panitia)`);
  return out;
}

/** Simpan banyak orang sekaligus (satu query per 500 baris); kode yang sama → diperbarui */
async function upsertPeople(list) {
  const cols = PERSON_FIELDS.join(', ');
  const types = PERSON_FIELDS.map((f) => `${f} ${f === 'venue_id' ? 'int' : 'text'}`).join(', ');
  const set = PERSON_FIELDS.filter((f) => f !== 'code').map((f) => `${f}=EXCLUDED.${f}`).join(', ');
  const out = [];
  for (let i = 0; i < list.length; i += 500) {
    const { rows } = await q(
      `INSERT INTO people (${cols})
       SELECT ${cols} FROM jsonb_to_recordset($1::jsonb) AS x(${types})
       ON CONFLICT (lower(code)) DO UPDATE SET ${set}
       RETURNING *`,
      [JSON.stringify(list.slice(i, i + 500))]
    );
    out.push(...rows);
  }
  return out;
}

r.post('/people', requireSuper, ah(async (req, res) => {
  const [row] = await upsertPeople([cleanPerson(req.body || {})]);
  res.json(row);
}));

r.put('/people/:id', requireSuper, ah(async (req, res) => {
  const p = cleanPerson(req.body || {});
  const { rows } = await q(
    `UPDATE people SET ${PERSON_FIELDS.map((f, i) => `${f}=$${i + 1}`).join(', ')}
     WHERE id=$${PERSON_FIELDS.length + 1} RETURNING *`,
    [...PERSON_FIELDS.map((f) => p[f]), req.params.id]
  );
  if (!rows[0]) throw new HttpError(404, 'Data tidak ditemukan');
  res.json(rows[0]);
}));

r.delete('/people/:id', requireSuper, ah(async (req, res) => {
  await q('DELETE FROM people WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

/**
 * Impor CSV. Format dikenali otomatis (lihat peopleImport.js):
 * urutan kolom lama, CSV ber-header (urutan bebas), atau file "Pemetaan Sekolah".
 */
r.post('/people/import', requireSuper, ah(async (req, res) => {
  const { format, people, skipped } = parsePeople(req.body?.csv);
  const { rows: venues } = await q('SELECT id, name FROM venues');
  // cocokkan nama venue tanpa peduli huruf besar/kecil, spasi, dan tanda baca
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const byName = new Map(venues.map((v) => [norm(v.name), v.id]));
  const errors = [];
  const missing = new Map(); // nama venue belum ada → jumlah orang
  const byCode = new Map(); // kode ganda dalam satu file → baris terakhir yang dipakai
  for (const [i, raw] of people.entries()) {
    try {
      let venue_id = null;
      if (raw.venue) {
        venue_id = byName.get(norm(raw.venue)) ?? null;
        if (!venue_id) missing.set(raw.venue, (missing.get(raw.venue) || 0) + 1);
      }
      const p = cleanPerson({ ...raw, venue_id }, req.body?.role);
      byCode.set(p.code.toLowerCase(), p);
    } catch (e) { errors.push(`Baris ${i + 1}: ${e.message}`); }
  }
  const saved = errors.length > 20 ? [] : await upsertPeople([...byCode.values()]);
  if (errors.length > 20) errors.unshift('Terlalu banyak baris bermasalah, tidak ada yang disimpan. Periksa format file.');
  const warnings = [...missing].map(([v, n]) =>
    `Venue "${v}" belum ada → ${n} orang diimpor tanpa venue. Tambahkan venue dengan nama itu lalu impor ulang file yang sama.`);
  const summary = {};
  for (const p of saved) summary[p.position || p.role] = (summary[p.position || p.role] || 0) + 1;
  if (skipped) warnings.push(`${skipped} nama kosong/"(BELUM ADA)" dilewati.`);
  res.json({ imported: saved.length, format, summary, errors: errors.slice(0, 30), warnings });
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
    role: b.role, type: String(b.type ?? '').trim().replace(/\s+/g, ' ').replace(/\s*-\s*$/, '') || 'Sesi Absensi',
    starts_at: new Date(b.starts_at), ends_at: new Date(b.ends_at),
    venue_ids: ids.length ? ids : null,
  };
  if (!s.name) throw new HttpError(400, 'Nama sesi wajib diisi');
  if (!['peserta', 'panitia', 'semua'].includes(s.role)) throw new HttpError(400, 'Peran sesi tidak valid');
  if (s.type.length > 80) throw new HttpError(400, 'Jenis sesi maksimal 80 karakter');
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

/* ---------- Scan QR peserta oleh LO / admin ---------- */
/**
 * Body: { qr } (isi QR: link /qr/<token> atau token saja) atau { code } (ketik manual),
 * opsional venue_id (admin utama). LO selalu tercatat di venue-nya sendiri.
 */
r.post('/scan', ah(async (req, res) => {
  const raw = String(req.body?.qr || '').trim();
  const code = String(req.body?.code || '').trim();
  const token = (raw.match(/([a-f0-9]{32})\s*$/i) || [])[1];
  if (!token && !code) throw new HttpError(400, 'QR tidak dikenali. Pastikan memindai QR absen peserta.');
  const { rows: [person] } = token
    ? await q('SELECT * FROM people WHERE qr_token=$1', [token.toLowerCase()])
    : await q('SELECT * FROM people WHERE lower(code)=lower($1)', [code]);
  if (!person) throw new HttpError(404, token ? 'QR tidak terdaftar (mungkin QR lama/tidak valid).' : 'Kode tidak terdaftar.');

  const lo = req.user.role === 'lo';
  let scannedBy = 'Admin utama';
  let venueId;
  if (lo) {
    const { rows: [acc] } = await q('SELECT name, active FROM lo_accounts WHERE id=$1', [req.user.lo]);
    if (!acc?.active) throw new HttpError(401, 'Akun LO tidak aktif. Silakan login ulang.');
    scannedBy = `LO ${acc.name}`;
    venueId = req.user.venue;
  } else {
    venueId = Number(req.body?.venue_id) || person.venue_id || null;
  }
  const brief = {
    name: person.name, code: person.code, role: person.role, position: person.position,
    institution: person.institution, ruangan: person.ruangan,
  };
  if (lo && person.venue_id && person.venue_id !== venueId) {
    const { rows: [pv] } = await q('SELECT name FROM venues WHERE id=$1', [person.venue_id]);
    throw new HttpError(403, `Terdaftar di venue lain (${pv?.name || '-'}). Arahkan ke venue tersebut.`, { person: brief });
  }

  const { rows: [session] } = await q(
    `SELECT * FROM sessions WHERE role IN ($1,'semua') AND now() BETWEEN starts_at AND ends_at
     ORDER BY starts_at LIMIT 1`, [person.role]);
  if (!session) throw new HttpError(400, `Belum ada sesi absensi ${person.role} yang dibuka saat ini.`, { person: brief });
  if (venueId && session.venue_ids?.length && !session.venue_ids.includes(venueId)) {
    throw new HttpError(400, `Sesi "${session.name}" tidak berlaku untuk venue ini.`, { person: brief });
  }

  const method = token ? 'qr' : 'manual';
  const { rows: [ins] } = await q(
    `INSERT INTO attendance (person_id, session_id, venue_id, status, risk_score, flags, method, scanned_by, ip, user_agent)
     VALUES ($1,$2,$3,'valid',0,$4,$8,$5,$6,$7)
     ON CONFLICT (person_id, session_id) DO NOTHING
     RETURNING created_at`,
    [person.id, session.id, venueId,
      JSON.stringify([{ code: 'qr_lo', detail: `${method === 'qr' ? 'Dipindai' : 'Diabsenkan'} oleh ${scannedBy}` }]),
      scannedBy, clientIp(req), String(req.get('user-agent') || '').slice(0, 300), method]
  );
  const sess = { name: session.name, type: session.type };
  if (!ins) {
    const { rows: [a] } = await q('SELECT created_at, status, method FROM attendance WHERE person_id=$1 AND session_id=$2',
      [person.id, session.id]);
    throw new HttpError(409, 'Sudah absen di sesi ini.', { person: brief, session: sess, at: a?.created_at, status: a?.status, method: a?.method });
  }
  res.json({ ok: true, person: brief, session: sess, at: ins.created_at });
}));

/* ---------- LO: cari sekolah lalu absenkan pesertanya ---------- */
// LO hanya melihat peserta venue-nya + peserta tanpa venue
r.get('/schools', ah(async (req, res) => {
  const term = String(req.query.q || '').trim();
  if (term.length < 2) return res.json([]);
  const v = req.user.role === 'lo' ? req.user.venue : null;
  const { rows } = await q(
    `SELECT * FROM (
       SELECT DISTINCT ON (s.npsn) s.npsn, s.school, p.kab_kota
       FROM people p,
            LATERAL unnest(string_to_array(p.npsn, '; '), string_to_array(p.institution, '; ')) AS s(npsn, school)
       WHERE p.role='peserta' AND p.npsn IS NOT NULL AND s.npsn IS NOT NULL
         AND ($2::int IS NULL OR p.venue_id IS NULL OR p.venue_id=$2)
         AND (s.school ILIKE '%'||$1||'%' OR s.npsn LIKE $1||'%' OR p.name ILIKE '%'||$1||'%')
       ORDER BY s.npsn, (p.position ILIKE 'bendahara') DESC
     ) x ORDER BY school LIMIT 20`,
    [term, v]);
  res.json(rows);
}));

r.get('/school/:npsn', ah(async (req, res) => {
  const npsn = String(req.params.npsn || '').replace(/\D/g, '');
  const lo = req.user.role === 'lo';
  const { rows: people } = await q(
    `SELECT p.id, p.code, p.name, p.position, p.npsn, p.institution, p.kab_kota, p.ruangan, p.venue_id, v.name AS venue_name
     FROM people p LEFT JOIN venues v ON v.id=p.venue_id
     WHERE p.role='peserta' AND $1 = ANY(string_to_array(replace(COALESCE(p.npsn,''), ' ', ''), ';'))
     ORDER BY CASE WHEN p.position ILIKE 'kepala%' THEN 0 WHEN p.position ILIKE 'bendahara' THEN 1
                   WHEN p.position ILIKE 'pengawas' THEN 2 ELSE 3 END, p.name`, [npsn]);
  if (!people.length) throw new HttpError(404, 'Sekolah tidak ditemukan');
  const { rows: [session] } = await q(
    `SELECT * FROM sessions WHERE role IN ('peserta','semua') AND now() BETWEEN starts_at AND ends_at
     ORDER BY starts_at LIMIT 1`);
  const att = new Map();
  if (session) {
    const { rows } = await q(
      'SELECT person_id, created_at, status, method FROM attendance WHERE session_id=$1 AND person_id = ANY($2::int[])',
      [session.id, people.map((p) => p.id)]);
    rows.forEach((a) => att.set(a.person_id, a));
  }
  const own = people.find((p) => p.npsn === npsn) || people[0];
  const idx = String(own.npsn || '').split('; ').indexOf(npsn);
  res.json({
    npsn,
    school: (idx >= 0 && String(own.institution || '').split('; ')[idx]) || own.institution,
    kab_kota: own.kab_kota,
    session: session ? { name: session.name, type: session.type } : null,
    people: people.map(({ id, npsn: _n, institution: _i, kab_kota: _k, ...p }) => ({
      ...p,
      other_venue: lo && p.venue_id != null && p.venue_id !== req.user.venue,
      attended: att.get(id) ? { at: att.get(id).created_at, status: att.get(id).status, method: att.get(id).method } : null,
    })),
  });
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
              a.created_at, a.device_id, a.user_agent, a.ip, a.photo_path, a.venue_id, a.method, a.scanned_by,
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
  const out = await Promise.all(rows.map(async ({ photo_path, ...x }) => ({ ...x, photo_url: photo_path ? await photoUrl(photo_path) : null })));
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
  if (!rows[0]?.photo_path) return res.status(404).end();
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
            p.npsn, p.region, p.ruangan, p.provinsi, p.kab_kota, p.ptn,
            a.status, a.created_at, av.name AS venue, a.lat, a.lng, a.distance_m, a.accuracy_m, a.flags, a.method
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
  const header = ['Kode', 'Nama', 'Peran', 'Instansi / Sekolah', 'Jabatan', 'NPSN', 'Region', 'Ruangan', 'Provinsi',
    'Kab/Kota', 'PTN', 'Venue Ditetapkan', 'Kehadiran', 'Status Verifikasi', 'Metode',
    'Waktu (WIB)', 'Venue Absen', 'Latitude', 'Longitude', 'Jarak (m)', 'Akurasi (m)', 'Catatan'];
  const lines = rows.map((x) => [
    x.code, x.name, x.role, x.institution, x.position, x.npsn, x.region, x.ruangan, x.provinsi,
    x.kab_kota, x.ptn, x.assigned_venue || 'Semua',
    x.status && x.status !== 'ditolak' ? 'Hadir' : 'Tidak hadir', x.status || '',
    ({ qr: 'Scan QR (LO)', manual: 'Diabsenkan LO', selfie: 'Selfie + GPS' })[x.method] || '',
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
