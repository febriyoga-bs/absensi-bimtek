import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import fs from 'fs';
import { q, getSettings, pool } from '../db.js';
import { ah, HttpError, clientIp } from '../util.js';
import {
  requireAdmin, requireLo, requireSuper, signAdmin, checkAdminPassword, hashPassword, verifyPassword,
} from '../auth.js';
import { deletePhoto, photoUrl, savePhoto } from '../storage.js';
import { parsePeople, EXTRA_FIELDS } from '../peopleImport.js';
import { applyParticipantPlan, getParticipantPlan } from '../participantSync.js';
import { getVenueAttendance, getVenueAttendanceDetails } from '../venueAttendance.js';
import { getAssignmentAttendance, getReportingSchoolAttendance } from '../assignmentAttendance.js';
import { getReporting, importReporting } from '../reporting.js';
import { reportingDates, reportingDays, withReportingDay } from '../reportingDays.js';
import { getArrivalRecap, getArrivalRecapDetails, importArrivalRecap } from '../arrivalRecap.js';

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
function scopeDay(req) {
  if (req.query.day == null || req.query.day === '') return null;
  if (!reportingDates.includes(req.query.day)) throw new HttpError(400, 'Hari absensi tidak valid.');
  return req.query.day;
}

/* ---------- Login (admin utama & LO venue) ---------- */
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 80, skipSuccessfulRequests: true,
  message: { error: 'Terlalu banyak percobaan login dari jaringan ini. Tunggu hingga 15 menit sebelum mencoba lagi.' } });
const passwordChangeLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, skipSuccessfulRequests: true,
  message: { error: 'Terlalu banyak percobaan ganti kata sandi dari jaringan ini. Tunggu hingga 15 menit sebelum mencoba lagi.' } });

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

r.get('/reporting', ah(async (req, res) => {
  res.json(await getReporting(req.query.dataset, req.user));
}));
r.get('/reporting/school/:npsn', ah(async (req, res) => {
  res.json(await getReportingSchoolAttendance(req.params.npsn, req.user));
}));
r.post('/reporting/import', requireSuper, ah(async (req, res) => {
  res.json(await importReporting(req.body?.csv));
}));
r.get('/arrival-recap', ah(async (req, res) => {
  res.json(await getArrivalRecap());
}));
r.get('/arrival-recap/:venueId/participants', ah(async (req, res) => {
  res.json(await getArrivalRecapDetails(req.params.venueId, req.query.group));
}));
r.post('/arrival-recap/import', requireSuper, ah(async (req, res) => {
  res.json(await importArrivalRecap(req.body?.rows));
}));

const publicLoAssignment = ({ account_id, venue_id, ...lo }) => lo;

r.get('/assignments/detail', ah(async (req, res) => {
  const { type, venue, lo } = req.query;
  if ([type, venue, lo].some((value) => typeof value !== 'string')) throw new HttpError(400, 'Filter rincian rekap wajib diisi.');
  res.json(await getAssignmentAttendance(type, venue, lo, null, req.user));
}));

r.get('/assignments', ah(async (_req, res) => {
  const { rows: [roster] } = await q("SELECT data - 'participants' - 'attendance_assignments' - 'organizations' AS data FROM assignment_roster WHERE id=1");
  if (!roster) return res.json(null);
  res.json({ ...roster.data, lo: roster.data.lo.map(publicLoAssignment), check_in_days: reportingDays });
}));

r.get('/assignments/mine', ah(async (req, res) => {
  if (req.user.role !== 'lo') throw new HttpError(403, 'Daftar ini hanya untuk akun LO.');
  const { rows: [roster] } = await q(
    `SELECT data - 'participants' - 'attendance_assignments' - 'organizations' AS data FROM assignment_roster
     JOIN lo_accounts l ON l.id=$1 AND l.active AND l.venue_id=$2
     WHERE assignment_roster.id=1`, [req.user.lo, req.user.venue]);
  const own = roster?.data.lo.find((lo) => lo.account_id === req.user.lo && lo.venue_id === req.user.venue);
  if (!own) return res.json(null);
  const belongsToLo = (row) => row.venue === own.venue && row.lo === own.name;
  res.json({
    lo: [publicLoAssignment(own)],
    venues: [own.venue],
    facilitators: roster.data.facilitators.filter(belongsToLo),
    schools: roster.data.schools.filter(belongsToLo),
  });
}));

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
r.post('/me/password', passwordChangeLimiter, ah(async (req, res) => {
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
const publicSettings = ({ venue_secret, venue_name, venue_lat, venue_lng, radius_m, require_venue_code, ...s }) => s;
const wibDays = (start, end) => `daterange((${start} AT TIME ZONE 'Asia/Jakarta')::date, (${end} AT TIME ZONE 'Asia/Jakarta')::date, '[]')`;

// Serialize session changes and changes to the rule using the settings row.
async function changeSchedule(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [settings] } = await client.query('SELECT * FROM settings WHERE id=1 FOR UPDATE');
    const result = await fn(client, settings);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

r.get('/settings', requireSuper, ah(async (req, res) => res.json(publicSettings(await getSettings()))));

r.put('/settings', requireSuper, ah(async (req, res) => {
  const b = req.body || {};
  const settings = await changeSchedule(async (db, current) => {
    const enabled = typeof b.one_official_session_per_day === 'boolean' ? b.one_official_session_per_day : current.one_official_session_per_day;
    if (enabled && !current.one_official_session_per_day) {
      const { rows: [conflict] } = await db.query(`SELECT a.name AS first, b.name AS second
        FROM sessions a JOIN sessions b ON a.id<b.id
        AND ${wibDays('a.starts_at', 'a.ends_at')} && ${wibDays('b.starts_at', 'b.ends_at')}
        WHERE NOT a.is_test AND NOT b.is_test
          AND LEAST(a.ends_at,b.ends_at) >= date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'
        ORDER BY a.starts_at,b.starts_at LIMIT 1`);
      if (conflict) throw new HttpError(409, `Rapikan jadwal terlebih dahulu. Sesi "${conflict.first}" dan "${conflict.second}" memakai tanggal WIB yang sama.`);
    }
    const { rows: [updated] } = await db.query(
      `UPDATE settings SET event_name=$1, organizer=$2, event_dates=$3, max_accuracy_m=$4,
        one_official_session_per_day=$5 WHERE id=1 RETURNING *`,
      [String(b.event_name || '').trim() || 'BIMTEK Revitalisasi SD', String(b.organizer || '').trim(),
        String(b.event_dates || '').trim(), Math.max(5, Number(b.max_accuracy_m) || 100), enabled]);
    return updated;
  });
  res.json(publicSettings(settings));
}));

/* ---------- Venue ---------- */
const publicVenue = ({ code_secret, ...v }) => v;

r.get('/venues', ah(async (req, res) => {
  const lo = req.user.role === 'lo' ? req.user.venue : null;
  const { rows } = await q(
    `SELECT v.*,
       (SELECT count(*) FROM people p WHERE p.venue_id=v.id AND p.archived_at IS NULL)::int AS people_count,
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
r.get('/people/sync', requireSuper, ah(async (_req, res) => {
  const { summary, revision, items, inactiveVenues } = await getParticipantPlan(pool);
  res.json({ summary, revision, items, inactiveVenues });
}));

r.post('/people/sync', requireSuper, ah(async (req, res) => {
  if (!/^[a-f0-9]{64}$/.test(req.body?.revision || '')) {
    throw new HttpError(400, 'Buka pratinjau sebelum menerapkan sinkronisasi.');
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('LOCK TABLE sessions IN SHARE MODE');
    await db.query('LOCK TABLE venues, people, assignment_roster IN SHARE ROW EXCLUSIVE MODE');
    const { rows: [session] } = await db.query(
      `SELECT 1 FROM sessions WHERE role IN ('peserta','semua')
       AND starts_at <= clock_timestamp() + interval '1 minute'
       AND ends_at >= clock_timestamp() - interval '1 minute' LIMIT 1`);
    if (session) throw new HttpError(409, 'Tunggu sampai sesi absensi peserta selesai sebelum menerapkan sinkronisasi.');
    const plan = await getParticipantPlan(db);
    if (req.body.revision !== plan.revision) {
      throw new HttpError(409, 'Daftar peserta berubah sejak pratinjau dibuat. Muat pratinjau baru.');
    }
    await applyParticipantPlan(db, plan);
    await db.query('COMMIT');
    res.json(plan.summary);
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}));

r.get('/people', requireSuper, ah(async (req, res) => {
  const role = ['peserta', 'panitia'].includes(req.query.role) ? req.query.role : null;
  const { rows } = await q(
    `SELECT p.*, v.name AS venue_name FROM people p LEFT JOIN venues v ON v.id=p.venue_id
     WHERE ($1::text IS NULL OR p.role=$1)
       AND (p.archived_at IS NOT NULL) = $3
       AND ($2::text = '' OR p.name ILIKE '%'||$2||'%' OR p.code ILIKE '%'||$2||'%' OR p.institution ILIKE '%'||$2||'%'
            OR p.npsn ILIKE '%'||$2||'%' OR p.kab_kota ILIKE '%'||$2||'%' OR p.ruangan ILIKE '%'||$2||'%')
     ORDER BY p.role, p.name`,
    [role, String(req.query.q || ''), req.query.archived === 'true']
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
const inRosterAt = (time) => `(p.roster_added_at IS NULL OR p.roster_added_at <= ${time})
  AND (p.archived_at IS NULL OR p.archived_at > ${time})`;

r.get('/venue-attendance', ah(async (req, res) => {
  res.json(await getVenueAttendance(scopeVenue(req), scopeDay(req)));
}));

r.get('/venue-attendance/:venueId/:group', ah(async (req, res) => {
  const venueId = Number(req.params.venueId);
  if (!Number.isInteger(venueId) || venueId < 1 || venueId > 2147483647) {
    throw new HttpError(400, 'Venue tidak valid.');
  }
  if (req.user.role === 'lo' && venueId !== req.user.venue) throw new HttpError(403, 'Bukan venue Anda.');
  res.json(await getVenueAttendanceDetails(venueId, req.params.group, scopeDay(req)));
}));

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
          AND ${inRosterAt('LEAST(now(), s.ends_at)')}
          AND (cardinality(COALESCE(s.venue_ids,'{}'))=0 OR p.venue_id IS NULL OR p.venue_id = ANY(s.venue_ids))
          AND ($1::int IS NULL OR p.venue_id IS NULL OR p.venue_id=$1))::int AS expected,
       (SELECT count(*) FROM attendance a WHERE a.session_id=s.id AND a.status='valid' AND ($1::int IS NULL OR a.venue_id=$1))::int AS valid,
       (SELECT count(*) FROM attendance a WHERE a.session_id=s.id AND a.status='review' AND ($1::int IS NULL OR a.venue_id=$1))::int AS review,
       (SELECT count(*) FROM attendance a WHERE a.session_id=s.id AND a.status='ditolak' AND ($1::int IS NULL OR a.venue_id=$1))::int AS rejected,
       (SELECT count(*) FROM attendance a WHERE a.session_id=s.id AND a.status='berhalangan' AND ($1::int IS NULL OR a.venue_id=$1))::int AS unavailable,
       (SELECT count(*) FROM attempt_logs l WHERE l.session_id=s.id AND ($1::int IS NULL OR l.venue_id=$1))::int AS blocked,
       (SELECT COALESCE(json_agg(x ORDER BY x.name), '[]') FROM (
          SELECT v.name, count(*)::int AS n FROM attendance a JOIN venues v ON v.id=a.venue_id
          WHERE a.session_id=s.id AND a.status IN ('valid','review') AND ($1::int IS NULL OR a.venue_id=$1) GROUP BY v.name) x) AS by_venue,
       now() BETWEEN s.starts_at AND s.ends_at AS is_open
     FROM sessions s
     WHERE ($1::int IS NULL OR cardinality(COALESCE(s.venue_ids,'{}'))=0 OR $1 = ANY(s.venue_ids))
       AND (NOT $2::boolean OR NOT s.is_test)
       AND ($3::date IS NULL OR (NOT s.is_test AND (s.starts_at AT TIME ZONE 'Asia/Jakarta')::date=$3))
     ORDER BY starts_at`,
    [v, req.query.official === '1', scopeDay(req)]
  );
  res.json(rows.map(withReportingDay));
}));

function cleanSession(b) {
  const ids = Array.isArray(b.venue_ids) ? b.venue_ids.map(Number).filter(Number.isInteger) : [];
  const s = {
    name: String(b.name || '').trim(),
    role: b.role, type: String(b.type ?? '').trim().replace(/\s+/g, ' ').replace(/\s*-\s*$/, '') || 'Sesi Absensi',
    starts_at: new Date(b.starts_at), ends_at: new Date(b.ends_at),
    venue_ids: ids.length ? ids : null,
    is_test: b.is_test === true || /\b(?:test|tes|uji\s+coba)\b/i.test(String(b.name || '') + ' ' + String(b.type || '')),
  };
  if (!s.name) throw new HttpError(400, 'Nama sesi wajib diisi');
  if (!['peserta', 'panitia', 'semua'].includes(s.role)) throw new HttpError(400, 'Peran sesi tidak valid');
  if (s.type.length > 80) throw new HttpError(400, 'Jenis sesi maksimal 80 karakter');
  if (isNaN(s.starts_at) || isNaN(s.ends_at) || s.ends_at <= s.starts_at) {
    throw new HttpError(400, 'Waktu mulai/selesai tidak valid');
  }
  return s;
}

async function saveSession(s, id) {
  return changeSchedule(async (db, settings) => {
    if (settings.one_official_session_per_day && !s.is_test) {
      const { rows: [conflict] } = await db.query(`SELECT name FROM sessions
        WHERE NOT is_test AND id IS DISTINCT FROM $3::int
          AND ${wibDays('starts_at', 'ends_at')} && ${wibDays('$1::timestamptz', '$2::timestamptz')}
        ORDER BY starts_at LIMIT 1`, [s.starts_at, s.ends_at, id]);
      if (conflict) throw new HttpError(409, `Sudah ada sesi resmi "${conflict.name}" pada tanggal WIB tersebut. Ubah jadwal yang ada atau pilih tanggal lain.`);
    }
    const values = [s.name, s.role, s.type, s.starts_at, s.ends_at, s.venue_ids, s.is_test];
    const { rows: [session] } = id == null
      ? await db.query('INSERT INTO sessions (name, role, type, starts_at, ends_at, venue_ids, is_test) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', values)
      : await db.query('UPDATE sessions SET name=$1, role=$2, type=$3, starts_at=$4, ends_at=$5, venue_ids=$6, is_test=$7 WHERE id=$8 RETURNING *', [...values, id]);
    if (!session) throw new HttpError(404, 'Sesi tidak ditemukan.');
    return session;
  });
}

r.post('/sessions', requireSuper, ah(async (req, res) => {
  res.json(await saveSession(cleanSession(req.body || {}), null));
}));

r.put('/sessions/:id', requireSuper, ah(async (req, res) => {
  res.json(await saveSession(cleanSession(req.body || {}), req.params.id));
}));

r.delete('/sessions/:id', requireSuper, ah(async (req, res) => {
  await q('DELETE FROM sessions WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

/* ---------- Scan QR peserta oleh LO / admin ---------- */
// Absenkan lewat scan QR dinonaktifkan sementara (absen manual + foto tetap jalan). Ubah ke true untuk mengaktifkan lagi.
const QR_SCAN_ENABLED = false;
const sessionApplies = (venue) => `(${venue} IS NULL OR cardinality(COALESCE(s.venue_ids,'{}'))=0 OR ${venue} = ANY(s.venue_ids))`;
const facilitatorPosition = "lower(trim(p.position)) ~ '^fasil(itator)?($|[[:space:]])'";
const scanCategories = {
  sekolah: "p.npsn IS NOT NULL OR lower(trim(p.position)) IN ('bendahara','pengawas')",
  fasil: facilitatorPosition,
  dinas: "lower(trim(p.position))='dinas pendidikan'",
  bpmp: "lower(trim(p.position))='bb/bpmp'",
};
const nameKeySql = (value) => `regexp_replace(lower(${value}), '[^[:alnum:]]', '', 'g')`;
// The owner and venue are resolved from the authenticated account, never the request body.
const assignedToLo = (account, venue, includeOrganizations = false) => `(${account}::int IS NULL OR (
  p.role='peserta' AND p.venue_id=${venue}::int AND EXISTS (
    SELECT 1 FROM lo_accounts l
    WHERE l.id=${account}::int AND l.active AND l.venue_id=${venue}::int
      AND (${includeOrganizations ? `${scanCategories.dinas} OR ${scanCategories.bpmp} OR ` : ''}EXISTS (
        SELECT 1 FROM assignment_roster r
        CROSS JOIN LATERAL jsonb_to_recordset(r.data->'attendance_assignments'->(l.id::text))
          AS m(code text,name text,position text,npsn text,venue_id int)
        WHERE r.id=1 AND m.venue_id=p.venue_id AND lower(trim(m.position))=lower(trim(p.position))
          AND ${nameKeySql('m.name')}=${nameKeySql('p.name')}
          AND (lower(m.code)=lower(p.code) OR (
            m.npsn IS NOT NULL AND string_to_array(replace(m.npsn,' ',''),';') &&
              string_to_array(replace(p.npsn,' ',''),';')
          ))
      ))
  )))`;
const canCheckInForLo = (account, venue) => assignedToLo(account, venue, true);

const canDeleteAttendance = (account, venue) => `(${account}::int IS NULL OR (
  a.venue_id=${venue}::int AND (
    ${assignedToLo(account, venue)} OR (
      p.role='panitia' AND p.venue_id=${venue}::int AND lower(trim(p.position))='lo' AND EXISTS (
        SELECT 1 FROM lo_accounts l
        WHERE l.id=${account}::int AND l.active AND l.venue_id=${venue}::int
          AND lower(l.username)=lower(p.code)
      )
    )
  )
))`;

r.get('/scan/participants', ah(async (req, res) => {
  const category = req.query.category || 'sekolah';
  if (typeof category !== 'string' || !Object.hasOwn(scanCategories, category)) {
    throw new HttpError(400, 'Kategori peserta tidak valid.');
  }
  const venueId = req.query.venue_id == null || req.query.venue_id === '' ? null : Number(req.query.venue_id);
  const page = Number(req.query.page || 1);
  if ((venueId !== null && (!Number.isInteger(venueId) || venueId < 1 || venueId > 2147483647))
    || !Number.isInteger(page) || page < 1 || page > 100000) {
    throw new HttpError(400, 'Filter venue atau halaman tidak valid.');
  }
  const limit = 30;
  const term = String(req.query.q || '').trim().slice(0, 150);
  const assignedOnly = req.user.role === 'lo' && req.query.scope !== 'all';
  const { rows: [list] } = await q(
    `WITH matching AS (
      SELECT p.id, p.role, p.code, p.name, p.position, p.phone, p.institution, p.npsn, p.ruangan, p.venue_id, v.name AS venue_name,
        arrival.marks->>p.id::text AS arrival_status
      FROM people p LEFT JOIN venues v ON v.id=p.venue_id
      LEFT JOIN venue_arrival_recap arrival ON arrival.venue_id=p.venue_id
      WHERE p.role='peserta' AND p.archived_at IS NULL AND (${scanCategories[category]})
        AND (NOT $7::boolean OR ${canCheckInForLo('$5', '$6')})
        AND ($2::int IS NULL OR p.venue_id=$2)
        AND ($1='' OR p.name ILIKE '%'||$1||'%' OR p.code ILIKE '%'||$1||'%'
          OR p.institution ILIKE '%'||$1||'%' OR p.npsn ILIKE '%'||$1||'%' OR v.name ILIKE '%'||$1||'%')
    ), filtered AS (
      SELECT * FROM matching WHERE $8::text='' OR arrival_status IN ('selesai','sudah_tiba')
        OR ($8='present' AND arrival_status='sedang_antre')
    ), page_rows AS (
      SELECT * FROM filtered ORDER BY name,id LIMIT $3 OFFSET $4
    ), details AS (
      SELECT p.id, p.code, p.name, p.position, p.phone, p.institution, p.npsn, p.ruangan, p.venue_name, p.arrival_status,
        ${canCheckInForLo('$5', '$6')} AS can_check_in,
        CASE WHEN s.id IS NOT NULL THEN json_build_object('id',s.id,'name',s.name,'type',s.type,'starts_at',s.starts_at) END AS session,
        CASE WHEN a.id IS NOT NULL THEN json_build_object('at',a.created_at,'status',a.status,'method',a.method) END AS recorded
      FROM page_rows p
      LEFT JOIN LATERAL (
        SELECT s.id,s.name,s.type,s.starts_at FROM sessions s
        WHERE NOT s.is_test AND s.role IN ('peserta','semua') AND now() BETWEEN s.starts_at AND s.ends_at
          AND ${sessionApplies('p.venue_id')}
        ORDER BY s.starts_at,s.id LIMIT 1
      ) s ON true
      LEFT JOIN attendance a ON a.person_id=p.id AND a.session_id=s.id
    )
    SELECT (SELECT count(*)::int FROM filtered) AS total,
      (SELECT json_build_object(
        'arrived', count(*) FILTER (WHERE arrival_status IN ('selesai','sudah_tiba')),
        'queued', count(*) FILTER (WHERE arrival_status='sedang_antre'),
        'unrecorded', count(*) FILTER (WHERE arrival_status IS NULL)
      ) FROM matching) AS arrival_summary,
      COALESCE((SELECT jsonb_agg(d ORDER BY d.name,d.id) FROM details d),'[]') AS rows,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'name',v.name) ORDER BY v.name) FROM venues v),'[]') AS venues`,
    [term, venueId, limit, (page - 1) * limit, req.user.lo, req.user.venue, assignedOnly,
      ['present', 'arrived'].includes(req.query.arrival) ? req.query.arrival : '']);
  res.json({
    total: list.total, limit, venues: list.venues, arrival_summary: list.arrival_summary,
    rows: list.rows.map(({ recorded, phone, ...person }) => ({
      ...person,
      session: withReportingDay(person.session),
      code: person.can_check_in ? person.code : undefined,
      can_check_in: req.user.role === 'lo' && person.can_check_in,
      phone: person.can_check_in && /^(bendahara|pengawas|fasil(?:itator)?(?:\s|$))/i.test(person.position || '') ? phone : undefined,
      unavailable: recorded?.status === 'berhalangan',
      attended: recorded?.status === 'berhalangan' ? null : recorded,
    })),
  });
}));

/**
 * Body: { qr } (isi QR: link /qr/<token> atau token saja) atau { code } (ketik manual),
 * Absensi LO selalu tercatat di venue penugasannya.
 */
r.post('/scan', requireLo, ah(async (req, res) => {
  const raw = String(req.body?.qr || '').trim();
  const code = String(req.body?.code || '').trim();
  const token = (raw.match(/([a-f0-9]{32})\s*$/i) || [])[1];
  const unavailable = req.body?.unavailable === true;
  if (!token && !code) throw new HttpError(400, 'QR tidak dikenali. Pastikan memindai QR absen peserta.');
  if (token && !QR_SCAN_ENABLED) throw new HttpError(400, 'Cari peserta melalui tabel Absenkan Peserta.');
  const { rows: [person] } = await q(
    `SELECT p.* FROM people p WHERE ${token ? 'p.qr_token=$1' : 'lower(p.code)=lower($1)'}
      AND p.archived_at IS NULL AND ${canCheckInForLo('$2', '$3')}`,
    [token ? token.toLowerCase() : code, req.user.lo, req.user.venue]);
  if (!person) throw new HttpError(403, 'Peserta ini di luar cakupan absensi Anda.');
  if (unavailable && (token || person.role !== 'peserta')) {
    throw new HttpError(400, 'Status berhalangan hanya bisa dicatat untuk peserta yang dipilih.');
  }

  const { rows: [acc] } = await q('SELECT name, active FROM lo_accounts WHERE id=$1', [req.user.lo]);
  if (!acc?.active) throw new HttpError(401, 'Akun LO tidak aktif. Silakan login ulang.');
  const scannedBy = `LO ${acc.name}`;
  const venueId = req.user.venue;
  const brief = {
    name: person.name, code: person.code, role: person.role, position: person.position,
    institution: person.institution, ruangan: person.ruangan,
  };
  const requestedSession = req.body?.session_id == null ? null : Number(req.body.session_id);
  if (requestedSession !== null && (!Number.isInteger(requestedSession) || requestedSession < 1 || requestedSession > 2147483647)) {
    throw new HttpError(400, 'Sesi tidak valid.');
  }
  const { rows: [sessionRow] } = await q(
    `SELECT id, name, type, starts_at FROM sessions s WHERE NOT s.is_test AND role IN ($1,'semua') AND now() BETWEEN starts_at AND ends_at
     AND ${sessionApplies('$2::int')} AND ($3::int IS NULL OR id=$3)
     ORDER BY starts_at, id LIMIT 1`, [person.role, venueId, requestedSession]);
  if (!sessionRow) throw new HttpError(400, 'Tidak ada sesi yang dibuka untuk peserta dan venue ini.', { person: brief });
  const session = withReportingDay(sessionRow);

  const method = token ? 'qr' : 'manual';
  const status = unavailable ? 'berhalangan' : 'valid';
  let note = null;
  let photo = null;
  if (method === 'manual' && !unavailable) {
    note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note || note.length > 1000) throw new HttpError(400, 'Catatan wajib diisi, maksimal 1.000 karakter.', { person: brief });
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.photo || ''));
    photo = m && Buffer.from(m[1], 'base64');
    if (!photo || photo.length < 4_000 || photo.length > 1_500_000 || photo[0] !== 0xff || photo[1] !== 0xd8) {
      throw new HttpError(400, 'Foto peserta wajib diambil dari kamera.', { person: brief });
    }
  }

  const findExisting = async () => (await q(
    'SELECT created_at, status, method, venue_id FROM attendance WHERE person_id=$1 AND session_id=$2', [person.id, session.id])).rows[0];
  const duplicate = (row) => {
    if (unavailable && row?.status === status && row.venue_id === venueId) {
      return res.json({ ok: true, person: brief, session, status, at: row.created_at });
    }
    throw new HttpError(409, 'Status peserta sudah tercatat di sesi ini.', {
      person: brief, session, at: row?.created_at, status: row?.status, method: row?.method,
    });
  };
  const existing = await findExisting();
  if (existing && (unavailable || existing.status !== 'berhalangan' || existing.venue_id !== venueId)) {
    return duplicate(existing);
  }

  let photoPath = null;
  if (photo) {
    photoPath = await savePhoto(
      `sesi-${session.id}/venue-${venueId || 0}/lo-${person.code.replace(/[^\w-]+/g, '_')}-${person.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.jpg`, photo);
  }
  const { rows: [ins] } = await q(
    `INSERT INTO attendance (person_id, session_id, venue_id, status, flags, method, scanned_by, ip, user_agent, photo_path, participant_note)
     SELECT $1,s.id,$3,$4,$5,$6,$7,$8,$9,$10,$11 FROM sessions s
     WHERE s.id=$2 AND NOT s.is_test AND now() BETWEEN s.starts_at AND s.ends_at AND ${sessionApplies('$3::int')}
       AND EXISTS (SELECT 1 FROM people p WHERE p.id=$1 AND p.archived_at IS NULL AND ${canCheckInForLo('$12', '$3')})
     ON CONFLICT (person_id, session_id) DO UPDATE SET
       status=EXCLUDED.status, flags=EXCLUDED.flags, method=EXCLUDED.method, scanned_by=EXCLUDED.scanned_by,
       ip=EXCLUDED.ip, user_agent=EXCLUDED.user_agent, photo_path=EXCLUDED.photo_path,
       participant_note=EXCLUDED.participant_note, created_at=EXCLUDED.created_at
     WHERE attendance.status='berhalangan' AND EXCLUDED.status='valid'
       AND attendance.venue_id IS NOT DISTINCT FROM EXCLUDED.venue_id
     RETURNING created_at`,
    [person.id, session.id, venueId, status,
      JSON.stringify(unavailable ? [] : [{ code: 'qr_lo', detail: `${method === 'qr' ? 'Dipindai' : 'Diabsenkan'} oleh ${scannedBy}` }]),
      method, scannedBy, clientIp(req), String(req.get('user-agent') || '').slice(0, 300), photoPath, note, req.user.lo]
  );
  if (!ins) {
    await deletePhoto(photoPath);
    const recorded = await findExisting();
    if (recorded) return duplicate(recorded);
    throw new HttpError(400, 'Sesi atau penugasan peserta berubah. Muat ulang daftar peserta.', { person: brief });
  }
  res.json({ ok: true, person: brief, session, status, at: ins.created_at });
}));

/* ---------- LO: cari sekolah lalu absenkan pesertanya ---------- */
r.get('/schools', ah(async (req, res) => {
  const term = String(req.query.q || '').trim();
  if (term.length < 2) return res.json([]);
  const v = req.user.role === 'lo' ? req.user.venue : null;
  const { rows } = await q(
    `SELECT * FROM (
       SELECT DISTINCT ON (s.npsn) s.npsn, s.school, p.kab_kota, v.name AS venue_name
       FROM people p LEFT JOIN venues v ON v.id=p.venue_id
       CROSS JOIN LATERAL unnest(string_to_array(p.npsn, '; '), string_to_array(p.institution, '; ')) AS s(npsn, school)
       WHERE p.role='peserta' AND p.archived_at IS NULL AND p.npsn IS NOT NULL AND s.npsn IS NOT NULL
         AND ${assignedToLo('$3', '$2')}
         AND (s.school ILIKE '%'||$1||'%' OR s.npsn LIKE $1||'%' OR p.name ILIKE '%'||$1||'%')
       ORDER BY s.npsn, (p.position ILIKE 'bendahara') DESC
     ) x ORDER BY school LIMIT 20`,
    [term, v, req.user.lo]);
  res.json(rows);
}));

async function scanPeople(req, condition, value) {
  const { rows: people } = await q(
    `SELECT p.code, p.name, p.position, p.npsn, p.institution, p.kab_kota, p.ruangan, p.venue_id, v.name AS venue_name,
       CASE WHEN s.id IS NOT NULL THEN json_build_object('id',s.id,'name',s.name,'type',s.type,'starts_at',s.starts_at) END AS session,
       CASE WHEN a.id IS NOT NULL THEN json_build_object('at',a.created_at,'status',a.status,'method',a.method) END AS recorded
     FROM people p LEFT JOIN venues v ON v.id=p.venue_id
     LEFT JOIN LATERAL (
       SELECT s.id, s.name, s.type, s.starts_at FROM sessions s
       WHERE NOT s.is_test AND s.role IN ('peserta','semua') AND now() BETWEEN s.starts_at AND s.ends_at
         AND ${sessionApplies('COALESCE($2::int,p.venue_id)')}
       ORDER BY s.starts_at, s.id LIMIT 1
     ) s ON true
     LEFT JOIN attendance a ON a.session_id=s.id AND a.person_id=p.id AND ($2::int IS NULL OR a.venue_id=$2)
     WHERE p.role='peserta' AND p.archived_at IS NULL
       AND ${condition} AND ${canCheckInForLo('$3', '$2')}
     ORDER BY CASE WHEN p.position ILIKE 'kepala%' THEN 0 WHEN p.position ILIKE 'bendahara' THEN 1
                   WHEN p.position ILIKE 'pengawas' THEN 2 ELSE 3 END, p.name`, [value, req.user.venue, req.user.lo]);
  return people;
}

function scanPersonResponse({ npsn, institution, kab_kota, recorded, ...person }) {
  return {
    ...person,
    session: withReportingDay(person.session),
    unavailable: recorded?.status === 'berhalangan',
    attended: recorded?.status === 'berhalangan' ? null : recorded,
  };
}

r.get('/school/:npsn', ah(async (req, res) => {
  const npsn = String(req.params.npsn || '').replace(/\D/g, '');
  const people = await scanPeople(req, "$1 = ANY(string_to_array(replace(COALESCE(p.npsn,''), ' ', ''), ';'))", npsn);
  if (!people.length) throw new HttpError(404, 'Sekolah tidak ditemukan');
  const own = people.find((p) => p.npsn === npsn) || people[0];
  const idx = String(own.npsn || '').split('; ').indexOf(npsn);
  res.json({
    npsn,
    school: (idx >= 0 && String(own.institution || '').split('; ')[idx]) || own.institution,
    kab_kota: own.kab_kota,
    session: own.session || people.find((p) => p.session)?.session || null,
    people: people.map(scanPersonResponse),
  });
}));

for (const [directory, position] of [
  ['facilitators', facilitatorPosition],
  ['dinas', scanCategories.dinas],
  ['bpmp', scanCategories.bpmp],
]) {
  r.get(`/${directory}`, ah(async (req, res) => {
    const term = String(req.query.q || '').trim();
    const { rows } = await q(
      `SELECT p.code, p.name, p.institution, v.name AS venue_name FROM people p LEFT JOIN venues v ON v.id=p.venue_id
       WHERE p.role='peserta' AND p.archived_at IS NULL AND ${position}
         AND (p.name ILIKE '%'||$1||'%' OR p.code ILIKE $1||'%' OR p.institution ILIKE '%'||$1||'%')
         AND ${canCheckInForLo('$3', '$2')} ORDER BY p.name, p.id LIMIT 20`,
      [term, req.user.venue, req.user.lo]);
    res.json(rows);
  }));

  r.get(`/${directory}/:code`, ah(async (req, res) => {
    const [person] = await scanPeople(req, `lower(p.code)=lower($1) AND ${position}`, req.params.code);
    if (!person) throw new HttpError(404, 'Peserta tidak ditemukan dalam daftar Anda.');
    res.json({ code: person.code, name: person.name, institution: person.institution, session: person.session,
      people: [scanPersonResponse(person)] });
  }));
}

/* ---------- Absensi ---------- */
/** Daftar absen per sesi, dengan halaman (default 48 per halaman) agar ringan. */
r.get('/attendance', ah(async (req, res) => {
  const v = scopeVenue(req);
  const status = ['valid', 'review', 'ditolak', 'berhalangan'].includes(req.query.status) ? req.query.status : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 48, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const where = `a.session_id=$1 AND ($2::int IS NULL OR a.venue_id=$2)`;
  const [{ rows }, { rows: [c] }] = await Promise.all([
    q(
      `SELECT a.id, a.status, a.risk_score, a.flags, a.lat, a.lng, a.accuracy_m, a.distance_m,
              a.created_at, a.device_id, a.user_agent, a.ip, a.photo_path, a.venue_id, a.method, a.scanned_by, a.participant_note,
              p.name, p.code, p.role, p.institution, p.position, v.name AS venue_name,
              ${assignedToLo('$6', '$2')} AS can_verify,
              ${canDeleteAttendance('$6', '$2')} AS can_delete
       FROM attendance a JOIN people p ON p.id=a.person_id LEFT JOIN venues v ON v.id=a.venue_id
       WHERE ${where} AND ($3::text IS NULL OR a.status=$3)
       ORDER BY a.risk_score DESC, a.created_at DESC
       LIMIT $4 OFFSET $5`,
      [req.query.session_id, v, status, limit, offset, req.user.lo]
    ),
    q(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE a.status='valid')::int AS valid,
              count(*) FILTER (WHERE a.status='review')::int AS review,
              count(*) FILTER (WHERE a.status='ditolak')::int AS ditolak,
              count(*) FILTER (WHERE a.status='berhalangan')::int AS berhalangan
       FROM attendance a WHERE ${where}`,
      [req.query.session_id, v]
    ),
  ]);
  // Signed URL R2 hanya untuk foto di halaman ini (bukan semua foto sesi)
  const out = await Promise.all(rows.map(async ({ photo_path, ...x }) => ({ ...x, photo_url: photo_path ? await photoUrl(photo_path) : null, has_photo: !!photo_path })));
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
  const { rows } = await q(
    `UPDATE attendance a SET status=$1 FROM people p
     WHERE a.id=$2 AND p.id=a.person_id AND a.status<>'berhalangan'
       AND ($3::int IS NULL OR a.venue_id=$4::int) AND ${assignedToLo('$3', '$4')}
     RETURNING a.id, a.status`, [req.body.status, req.params.id, req.user.lo, req.user.venue]);
  if (!rows.length) throw new HttpError(409, 'Status ini hanya dapat diubah untuk absensi peserta yang dapat Anda verifikasi.');
  res.json(rows[0]);
}));

r.delete('/attendance/:id', ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) throw new HttpError(400, 'ID absensi tidak valid.');
  if (req.body?.confirmation !== 'saya ingin menghapus absen ini') {
    throw new HttpError(400, 'Ketik persis frasa konfirmasi untuk menghapus absensi.');
  }

  const { rows: [deleted] } = await q(
    `DELETE FROM attendance a USING people p
     WHERE a.id=$1 AND p.id=a.person_id AND ${canDeleteAttendance('$2', '$3')}
     RETURNING a.photo_path`,
    [id, req.user.lo, req.user.venue]
  );
  if (!deleted) throw new HttpError(404, 'Absensi tidak ditemukan atau tidak dapat Anda hapus.');
  await deletePhoto(deleted.photo_path);
  res.sendStatus(204);
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
  if (!/^\d{1,10}$/.test(req.params.id) || Number(req.params.id) > 2147483647) throw new HttpError(404, 'Foto tidak ditemukan.');
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
 * CSV bawaan berisi absensi valid dan perlu dicek.
 * include_all=true menambahkan peserta yang belum absen dan status lainnya.
 */
r.get('/export', ah(async (req, res) => {
  const v = scopeVenue(req);
  const { rows: [s] } = await q('SELECT * FROM sessions WHERE id=$1', [req.query.session_id]);
  if (!s) throw new HttpError(404, 'Sesi tidak ditemukan');
  const { rows } = await q(
    `SELECT p.name, p.role, p.institution, p.position, pv.name AS assigned_venue,
            p.npsn, p.provinsi, p.kab_kota, p.ptn,
            a.id AS attendance_id, a.photo_path IS NOT NULL AS has_photo,
            a.status, a.created_at, av.name AS venue, a.flags, a.method, a.participant_note
     FROM people p
     LEFT JOIN venues pv ON pv.id=p.venue_id
     LEFT JOIN attendance a ON a.person_id=p.id AND a.session_id=$1
     LEFT JOIN venues av ON av.id=a.venue_id
     WHERE (a.id IS NOT NULL AND ($6::boolean OR a.status IN ('valid','review')) AND ($4::int IS NULL OR a.venue_id=$4))
        OR ($6::boolean AND a.id IS NULL AND ($2='semua' OR p.role=$2) AND ${inRosterAt('LEAST(now(), $5::timestamptz)')}
            AND (cardinality(COALESCE($3::int[],'{}'))=0 OR p.venue_id IS NULL OR p.venue_id = ANY($3::int[]))
            AND ($4::int IS NULL OR p.venue_id IS NULL OR p.venue_id=$4))
     ORDER BY p.role, p.name`,
    [s.id, s.role, s.venue_ids, v, s.ends_at, req.query.include_all === 'true']
  );
  let venueName = '';
  if (v) venueName = (await q('SELECT name FROM venues WHERE id=$1', [v])).rows[0]?.name || '';
  const esc = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const safeNote = (note) => note && /^(?:\s*[=+@-]|[\t\r\n])/.test(note) ? "'" + note : note;
  const fmt = (d) => d ? new Date(d).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '';
  const header = ['Nama', 'Peran', 'Instansi / Sekolah', 'Jabatan', 'NPSN', 'Provinsi',
    'Kab/Kota', 'PTN', 'Venue Ditetapkan', 'Status Absensi', 'Metode',
    'Waktu (WIB)', 'Venue Absen', 'Catatan', 'Catatan peserta', 'URL Foto'];
  const host = req.get('host');
  const origin = /^(?:[\w.-]+|\[[0-9a-f:]+\])(?::\d+)?$/i.test(host || '') ? `${req.secure ? 'https' : 'http'}://${host}` : '';
  const lines = rows.map((x) => [
    x.name, x.role, x.institution, x.position, x.npsn, x.provinsi,
    x.kab_kota, x.ptn, x.assigned_venue || 'Semua',
    ({ valid: 'Sudah absen', review: 'Sudah absen', berhalangan: 'Mundur/Berhalangan Hadir', ditolak: 'Absensi ditolak' })[x.status] || 'Belum absen',
    ({ qr: 'Scan QR (LO)', manual: 'Diabsenkan LO', selfie: 'Selfie + GPS' })[x.method] || '',
    fmt(x.created_at), x.venue || '',
    (x.flags || []).map((f) => f.detail).join('; '),
    safeNote(x.participant_note),
    x.has_photo && origin ? `${origin}/admin/absensi/foto/${x.attendance_id}` : '',
  ].map(esc).join(','));
  const day = withReportingDay(s).check_in_day;
  const title = day ? `${day.label} ${day.date}` : `absensi-${s.name}`;
  const name = `${title}${venueName ? '-' + venueName : ''}`.replace(/[^\w-]+/g, '_') + '.csv';
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${name}"`);
  res.send('﻿' + [header.map(esc).join(','), ...lines].join('\r\n'));
}));

export default r;
