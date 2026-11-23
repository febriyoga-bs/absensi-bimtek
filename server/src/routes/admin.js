import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import fs from 'fs';
import { q, getSettings, pool, rawPool } from '../db.js';
import { ah, HttpError, clientIp } from '../util.js';
import {
  requireAdmin, requireLo, requireSuper, signAdmin, checkAdminPassword, hashPassword, verifyPassword,
} from '../auth.js';
import { deletePhoto, photoUrl, savePhoto, readPhoto } from '../storage.js';
import { parsePeople, EXTRA_FIELDS } from '../peopleImport.js';
import { applyParticipantPlan, getParticipantPlan } from '../participantSync.js';
import { getVenueAttendance, getVenueAttendanceDetails } from '../venueAttendance.js';
import { getAssignmentAttendance, getReportingSchoolAttendance } from '../assignmentAttendance.js';
import { getReporting, importReporting } from '../reporting.js';
import { progressStatusSql, currentProgressSql, periodStatusSql } from '../progressImport.js';
import { reportingDates, reportingDays, withReportingDay } from '../reportingDays.js';
import { getArrivalRecap, getArrivalRecapDetails, importArrivalRecap } from '../arrivalRecap.js';
import { finiteInteger } from '../security.js';
import { pksRoutes } from '../pks.js';
import { eventId } from '../eventContext.js';
import { loginLo } from '../loLogin.js';
import { changeLoPassword } from '../loPassword.js';
import { eventVenueScope } from '../eventVenues.js';
import { attendanceExportLoCtes } from '../attendanceExport.js';

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
export const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 80, skipSuccessfulRequests: true,
  message: { error: 'Terlalu banyak percobaan login dari jaringan ini. Tunggu hingga 15 menit sebelum mencoba lagi.' } });
const passwordChangeLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, skipSuccessfulRequests: true,
  message: { error: 'Terlalu banyak percobaan ganti kata sandi dari jaringan ini. Tunggu hingga 15 menit sebelum mencoba lagi.' } });

export const loginHandler = ah(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (username.toLowerCase() === 'admin.pks.spab') {
    const { rows: [exists] } = await rawPool.query("SELECT to_regclass('public.pks_admin_account') AS name");
    const account = exists?.name && (await rawPool.query('SELECT password_hash FROM public.pks_admin_account WHERE id=1')).rows[0];
    if (!account || !verifyPassword(password, account.password_hash)) throw new HttpError(401, 'Username atau password salah');
    const { rows: [event] } = await rawPool.query('SELECT id,name,status FROM public.bimtek_events WHERE id=5');
    if (!event) throw new HttpError(409, 'Kegiatan PKS belum disiapkan.');
    return res.json({ token: signAdmin({ role: 'admin', scope: 'pks', event: 5 }), user: { role: 'admin', scope: 'pks', name: 'Admin PKS Satdik Aman Bencana', events: [5] }, event });
  }

  if (!username) {
    if (!checkAdminPassword(password)) throw new HttpError(401, 'Password salah');
    const { rows: [event] } = await rawPool.query("SELECT id,name,status FROM public.bimtek_events ORDER BY (status='active') DESC,id DESC LIMIT 1");
    return res.json({ token: signAdmin({ role: 'admin' }), user: { role: 'admin', name: 'Admin utama' }, event });
  }

  const { claims, user, event } = await loginLo(username, password, req.query.event);
  res.json({ token: signAdmin(claims), user, event });
});

r.use(requireAdmin);
r.use('/pks', pksRoutes);

r.get('/reporting', ah(async (req, res) => {
  res.json(await getReporting(req.query.dataset, req.user));
}));
r.get('/reporting/school/:npsn', ah(async (req, res) => {
  res.json(await getReportingSchoolAttendance(req.params.npsn, req.user));
}));
r.post('/reporting/import', requireSuper, ah(async (req, res) => {
  res.json(await importReporting(req.body?.csv));
}));
r.get('/arrival-recap', requireSuper, ah(async (req, res) => {
  res.json(await getArrivalRecap());
}));
r.get('/arrival-recap/:venueId/participants', requireSuper, ah(async (req, res) => {
  if (req.user.role === 'lo' && Number(req.params.venueId) !== req.user.venue) throw new HttpError(403, 'Bukan venue Anda.');
  res.json(await getArrivalRecapDetails(req.params.venueId, req.query.group));
}));
r.post('/arrival-recap/import', requireSuper, ah(async (req, res) => {
  res.json(await importArrivalRecap(req.body?.rows, req.body?.summary));
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
    check_in_days: reportingDays,
  });
}));

/** Info akun yang sedang login (dipanggil saat dashboard dibuka; LO nonaktif langsung ditolak). */
r.get('/me', ah(async (req, res) => {
  if (req.user.role === 'admin') return res.json({ role: 'admin', name: req.user.scope === 'pks' ? 'Admin PKS Satdik Aman Bencana' : 'Admin utama', ...(req.user.scope === 'pks' && { scope: 'pks', events: [5] }) });
  const {rows:events} = await q('SELECT id,name,status FROM public.bimtek_events ORDER BY id');
  if (req.user.no_assignment) return res.json({role:'lo',name:req.user.name,venue:null,no_assignment:true,events});
  const { rows: [lo] } = await q(
    `SELECT l.name, l.active, v.id AS venue_id, v.name AS venue_name
     FROM lo_accounts l JOIN venues v ON v.id=l.venue_id WHERE l.id=$1`, [req.user.lo]);
  if (!lo || !lo.active) throw new HttpError(401, 'Akun LO tidak aktif. Silakan login ulang.');
  res.json({ role: 'lo', name: lo.name, venue: { id: lo.venue_id, name: lo.venue_name }, ...(events && { events }) });
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
  await changeLoPassword(req.user.lo, oldPw, newPw);
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
    `SELECT v.*, ${eventVenueScope('v')} AS in_event,
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
  if (eventId() === 5) throw new HttpError(409, 'Profil PKS dikelola melalui Peserta & Panitia; sinkronisasi Pelaporan tidak berlaku.');
  const { summary, revision, items, inactiveVenues } = await getParticipantPlan(pool);
  res.json({ summary, revision, items, inactiveVenues });
}));

r.post('/people/sync', requireSuper, ah(async (req, res) => {
  if (eventId() === 5) throw new HttpError(409, 'Profil PKS dikelola melalui Peserta & Panitia; sinkronisasi Pelaporan tidak berlaku.');
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
// Profil Admin Ryan disimpan sebagai panitia, tetapi tidak diwajibkan absen.
const inRosterAt = (time) => `(p.roster_added_at IS NULL OR p.roster_added_at <= ${time})
  AND (p.archived_at IS NULL OR p.archived_at > ${time})
  AND NOT (p.role='panitia' AND lower(p.code)='admin.ryan')`;

async function scopeTestSession(req) {
  if (!req.query.test_session_id) return null;
  const id = Number(req.query.test_session_id);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw new HttpError(400, 'Sesi test tidak valid.');
  if (req.query.day) throw new HttpError(400, 'Pilih hari resmi atau sesi test.');
  const { rows: [session] } = await q(`SELECT id FROM sessions WHERE id=$1 AND is_test
    AND ($2::int IS NULL OR cardinality(COALESCE(venue_ids,'{}'))=0 OR $2=ANY(venue_ids))`, [id, scopeVenue(req)]);
  if (!session) throw new HttpError(404, 'Sesi test tidak ditemukan untuk venue ini.');
  return id;
}
r.get('/venue-attendance', ah(async (req, res) => {
  res.json(await getVenueAttendance(scopeVenue(req), scopeDay(req), await scopeTestSession(req)));
}));

r.get('/venue-attendance/:venueId/:group', ah(async (req, res) => {
  const venueId = Number(req.params.venueId);
  if (!Number.isInteger(venueId) || venueId < 1 || venueId > 2147483647) {
    throw new HttpError(400, 'Venue tidak valid.');
  }
  if (req.user.role === 'lo' && venueId !== req.user.venue) throw new HttpError(403, 'Bukan venue Anda.');
  res.json(await getVenueAttendanceDetails(venueId, req.params.group, scopeDay(req), await scopeTestSession(req)));
}));

/**
 * Rekap per sesi. Untuk LO (atau admin yang memfilter venue) semua angka dihitung
 * hanya untuk venue tsb:
 *  - sesi yang ditampilkan: sesi untuk semua venue, atau yang mencakup venue ini
 *  - "expected": target absensi yang ditetapkan ke venue ini + target tanpa venue
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
          WHERE a.session_id=s.id AND a.status IN ('valid','review','ditolak','berhalangan') AND ($1::int IS NULL OR a.venue_id=$1) GROUP BY v.name) x) AS by_venue,
       now() BETWEEN s.starts_at AND s.ends_at AS is_open
     FROM sessions s
     WHERE ($1::int IS NULL OR cardinality(COALESCE(s.venue_ids,'{}'))=0 OR $1 = ANY(s.venue_ids))
       AND (NOT $2::boolean OR NOT s.is_test)
       AND (NOT $4::boolean OR s.is_test)
       AND ($3::date IS NULL OR (NOT s.is_test AND (s.starts_at AT TIME ZONE 'Asia/Jakarta')::date=$3))
     ORDER BY starts_at`,
    [v, req.query.official === '1', scopeDay(req), req.query.test_only === '1']
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
const facilitatorPosition = "lower(trim(p.position)) ~ '^(verifikator|fasil(itator)?)($|[[:space:]])'";
const scanCategories = {
  sekolah: "p.npsn IS NOT NULL OR lower(trim(p.position)) IN ('bendahara','pengawas','kepala sekolah')",
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
const recordedByLo = (account, venue) => `(${account}::int IS NULL OR (
  p.role='peserta' AND a.venue_id=${venue}::int AND a.method IN ('manual','qr')
  AND EXISTS (SELECT 1 FROM lo_accounts own WHERE own.id=${account}::int AND own.active
    AND own.venue_id=${venue}::int AND a.scanned_by='LO '||own.name
    AND NOT EXISTS (SELECT 1 FROM lo_accounts other WHERE other.id<>own.id
      AND other.venue_id=own.venue_id AND other.name=own.name))))`;

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
  const ownerId = (req.query.lo_id === 'mine' || req.query.lo_id == null) && req.user.role === 'lo' ? req.user.lo
    : req.query.lo_id == null || req.query.lo_id === '' ? null : Number(req.query.lo_id);
  const positionFilter = req.query.position || '';
  if (!['', 'bendahara', 'pengawas'].includes(positionFilter) || (positionFilter && category !== 'sekolah')) {
    throw new HttpError(400, 'Filter jabatan peserta tidak valid.');
  }
  const attendanceFilter = req.query.attendance || '';
  const facilitatorFilter = req.query.facilitator || '';
  if (typeof facilitatorFilter !== 'string' || facilitatorFilter.length > 400) throw new HttpError(400, 'Filter fasilitator tidak valid.');
  const sortColumns = {
    name: "lower(COALESCE(representative->>'name',name))",
    institution: 'lower(institution)', venue: 'lower(venue_name)',
    lo: "lower(assigned_los->>0)",
    facilitator: `(SELECT min(lower(sf.facilitator)) FROM school_facilitators sf
      WHERE sf.venue=venue_name AND sf.npsn=ANY(string_to_array(replace(filtered.npsn,' ',''),';')))`,
    session: 'lower(selected_session_name)',
    report: `(SELECT min(${progressStatusSql('report','pr')}) FROM school_facilitators school
      LEFT JOIN school_reporting report ON report.npsn=school.npsn
      LEFT JOIN school_progress_report pr ON pr.npsn=school.npsn
      WHERE school.venue=venue_name AND school.npsn=ANY(string_to_array(replace(filtered.npsn,' ',''),';')))`,
    arrival: "CASE WHEN arrival_status IN ('selesai','sudah_tiba') THEN 'Sudah tiba' WHEN arrival_status='sedang_antre' THEN 'Sedang antre' ELSE 'Belum terdata' END",
    attendance: "CASE WHEN selected_session_id IS NULL THEN 'Belum ada sesi' WHEN selected_status IS NULL THEN 'Belum absen' WHEN selected_status='valid' THEN 'Sudah absen' WHEN selected_status='review' THEN 'Perlu dicek' WHEN selected_status='ditolak' THEN 'Ditolak' ELSE 'Mundur/Berhalangan Hadir' END",
  };
  const sort = req.query.sort || 'name';
  const direction = req.query.direction || 'asc';
  if (typeof sort !== 'string' || !Object.hasOwn(sortColumns,sort) || !['asc','desc'].includes(direction)) {
    throw new HttpError(400, 'Urutan kolom tidak valid.');
  }
  const order = `${sortColumns[sort]} ${direction.toUpperCase()} NULLS LAST,id ASC`;
  if ((ownerId !== null && (!Number.isInteger(ownerId) || ownerId < 1 || ownerId > 2147483647))
    || !['','checked_in','not_checked_in','review','ditolak','berhalangan','no_session'].includes(attendanceFilter)) {
    throw new HttpError(400, 'Filter LO atau status absensi tidak valid.');
  }
  const testSessionId = req.query.session_id == null || req.query.session_id === '' ? null : Number(req.query.session_id);
  if (testSessionId !== null && (!Number.isInteger(testSessionId) || testSessionId < 1 || testSessionId > 2147483647)) {
    throw new HttpError(400, 'Sesi uji coba tidak valid.');
  }
  const { rows: [list] } = await q(
    `WITH active_owners AS MATERIALIZED (
      SELECT id,name,venue_id FROM lo_accounts WHERE active
    ), candidate_people AS MATERIALIZED (
      SELECT p.* FROM people p
      WHERE p.role='peserta' AND p.archived_at IS NULL AND (${scanCategories[category]})
        AND ($7::text='' OR (lower(trim(p.position))=$7 OR ($7='pengawas' AND lower(trim(p.position))='kepala sekolah')))
        AND ($2::int IS NULL OR p.venue_id=$2)
        AND ($10::int IS NULL OR p.venue_id=(SELECT venue_id FROM active_owners WHERE id=$10))
    ), mappings AS MATERIALIZED (
      SELECT l.id AS account_id,l.name AS lo_name,m.venue_id,lower(m.code) AS code,
        lower(trim(m.position)) AS position,${nameKeySql('m.name')} AS name_key,
        string_to_array(replace(m.npsn,' ',''),';') AS school_ids
      FROM assignment_roster roster
      CROSS JOIN LATERAL jsonb_each(roster.data->'attendance_assignments') entries
      JOIN active_owners l ON entries.key=l.id::text
      CROSS JOIN LATERAL jsonb_to_recordset(entries.value)
        AS m(code text,name text,position text,npsn text,venue_id int)
      WHERE roster.id=1 AND m.venue_id=l.venue_id
        AND m.venue_id IN (SELECT venue_id FROM candidate_people)
    ), assigned_people AS MATERIALIZED (
      SELECT DISTINCT p.id,m.account_id,m.lo_name
      FROM candidate_people p JOIN mappings m ON p.venue_id=m.venue_id
        AND lower(trim(p.position))=m.position AND ${nameKeySql('p.name')}=m.name_key
        AND (lower(p.code)=m.code OR (m.school_ids IS NOT NULL
          AND m.school_ids && string_to_array(replace(p.npsn,' ',''),';')))
      WHERE p.role='peserta' AND p.archived_at IS NULL
      UNION
      SELECT p.id,l.id,l.name FROM candidate_people p JOIN active_owners l ON p.venue_id=l.venue_id
      WHERE p.role='peserta' AND p.archived_at IS NULL AND lower(trim(p.position)) IN ('dinas pendidikan','bb/bpmp')
    ), assignments AS MATERIALIZED (
      SELECT id,jsonb_agg(lo_name ORDER BY lo_name) AS assigned_los,
        bool_or(account_id=$5::int) AS owned FROM assigned_people GROUP BY id
    ), school_facilitators AS MATERIALIZED (
      SELECT school.npsn,school.name,school.venue,school.facilitator
      FROM assignment_roster roster
      CROSS JOIN LATERAL jsonb_to_recordset(roster.data->'schools')
        AS school(npsn text,name text,venue text,facilitator text)
      WHERE roster.id=1
    ), matching AS (
      SELECT p.id, p.role, p.code, p.name, p.position, p.phone, p.institution, p.npsn, p.ruangan, p.venue_id, v.name AS venue_name,
        arrival.marks->>p.id::text AS arrival_status,arrival.representatives->p.id::text AS representative,
        selected_session.id AS selected_session_id,selected_session.name AS selected_session_name,selected_session.status AS selected_status,
        COALESCE(assignment.assigned_los,'[]'::jsonb) AS assigned_los,
        ($5::int IS NULL OR (p.venue_id=$6::int AND COALESCE(assignment.owned,false))) AS can_check_in
      FROM candidate_people p LEFT JOIN venues v ON v.id=p.venue_id
      LEFT JOIN venue_arrival_recap arrival ON arrival.venue_id=p.venue_id
      LEFT JOIN assignments assignment ON assignment.id=p.id
      LEFT JOIN LATERAL (
        SELECT s.id,s.name,a.status FROM sessions s
        LEFT JOIN attendance a ON a.session_id=s.id AND a.person_id=p.id
        WHERE (($9::int IS NULL AND NOT s.is_test) OR (s.id=$9 AND s.is_test))
          AND s.role IN ('peserta','semua') AND now() BETWEEN s.starts_at AND s.ends_at
          AND ${sessionApplies('p.venue_id')}
        ORDER BY s.starts_at,s.id LIMIT 1
      ) selected_session ON true
      WHERE p.role='peserta' AND p.archived_at IS NULL AND (${scanCategories[category]})
        AND ($7::text='' OR (lower(trim(p.position))=$7 OR ($7='pengawas' AND lower(trim(p.position))='kepala sekolah')))
        AND ($2::int IS NULL OR p.venue_id=$2)
        AND ($10::int IS NULL OR EXISTS (SELECT 1 FROM assigned_people ap WHERE ap.id=p.id AND ap.account_id=$10))
        AND ($1='' OR p.name ILIKE '%'||$1||'%' OR p.code ILIKE '%'||$1||'%'
          OR p.institution ILIKE '%'||$1||'%' OR p.npsn ILIKE '%'||$1||'%' OR v.name ILIKE '%'||$1||'%'
          OR arrival.representatives->p.id::text->>'name' ILIKE '%'||$1||'%')
    ), filtered AS (
      SELECT * FROM matching WHERE ($8::text=''
        OR ($8 IN ('arrived','present') AND arrival_status IN ('selesai','sudah_tiba'))
        OR ($8='present' AND arrival_status='sedang_antre')
        OR ($8='queued' AND arrival_status='sedang_antre')
        OR ($8='unrecorded' AND COALESCE(arrival_status,'') NOT IN ('selesai','sudah_tiba','sedang_antre')))
        AND ($11::text=''
          OR ($11='checked_in' AND selected_status IN ('valid','review'))
          OR ($11='not_checked_in' AND selected_session_id IS NOT NULL AND selected_status IS NULL)
          OR ($11 IN ('review','ditolak','berhalangan') AND selected_status=$11)
          OR ($11='no_session' AND selected_session_id IS NULL))
        AND ($12::text='' OR EXISTS (SELECT 1 FROM school_facilitators school
          WHERE school.venue=matching.venue_name AND school.facilitator=$12
            AND school.npsn=ANY(string_to_array(replace(matching.npsn,' ',''),';'))))
    ), page_rows AS (
      SELECT *,row_number() OVER (ORDER BY ${order}) AS sort_order
      FROM filtered ORDER BY ${order} LIMIT $3 OFFSET $4
    ), details AS (
      SELECT p.id, p.code, p.name, p.position, p.phone, p.institution, p.npsn, p.ruangan, p.venue_name, p.arrival_status,p.sort_order,
        p.assigned_los,p.can_check_in,p.representative,
        COALESCE((SELECT jsonb_agg(names.facilitator ORDER BY names.facilitator) FROM (
          SELECT DISTINCT school.facilitator FROM school_facilitators school
          WHERE school.venue=p.venue_name
            AND school.npsn=ANY(string_to_array(replace(p.npsn,' ',''),';'))
        ) names),'[]'::jsonb) AS assigned_facilitators,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('npsn',school.npsn,'name',school.name,
          'status',${progressStatusSql('report','pr')},'weekly_status',${periodStatusSql('pr','weekly')},'monthly_status',${periodStatusSql('pr','monthly')},'progress',CASE WHEN ${currentProgressSql('report','pr')} THEN pr.progress ELSE report.progress END) ORDER BY school.name,school.npsn)
          FROM school_facilitators school LEFT JOIN school_reporting report ON report.npsn=school.npsn
          LEFT JOIN school_progress_report pr ON pr.npsn=school.npsn
          WHERE school.venue=p.venue_name
            AND ${category === 'fasil'
              ? `${nameKeySql('school.facilitator')}=${nameKeySql('p.name')}`
              : "school.npsn=ANY(string_to_array(replace(p.npsn,' ',''),';'))"}),'[]'::jsonb) AS school_reports,
        CASE WHEN s.id IS NOT NULL THEN json_build_object('id',s.id,'name',s.name,'type',s.type,'starts_at',s.starts_at,'is_test',s.is_test) END AS session,
        CASE WHEN a.id IS NOT NULL THEN json_build_object('id',a.id,'at',a.created_at,'status',a.status,'method',a.method,
          'participant_note',CASE WHEN p.can_check_in THEN a.participant_note END,
          'can_edit_note',a.venue_id=$6::int AND p.can_check_in AND ${recordedByLo('$5', '$6')}) END AS recorded
      FROM page_rows p
      LEFT JOIN LATERAL (
        SELECT s.id,s.name,s.type,s.starts_at,s.is_test FROM sessions s
        WHERE (($9::int IS NULL AND NOT s.is_test) OR (s.id=$9 AND s.is_test))
          AND s.role IN ('peserta','semua') AND now() BETWEEN s.starts_at AND s.ends_at
          AND ${sessionApplies('p.venue_id')}
        ORDER BY s.starts_at,s.id LIMIT 1
      ) s ON true
      LEFT JOIN attendance a ON a.person_id=p.id AND a.session_id=s.id
    )
    SELECT (SELECT count(*)::int FROM filtered) AS total,
      (SELECT json_build_object(
        'arrived', count(*) FILTER (WHERE arrival_status IN ('selesai','sudah_tiba')),
        'queued', count(*) FILTER (WHERE arrival_status='sedang_antre'),
        'unrecorded', count(*) FILTER (WHERE COALESCE(arrival_status,'') NOT IN ('selesai','sudah_tiba','sedang_antre'))
      ) FROM matching) AS arrival_summary,
      COALESCE((SELECT jsonb_agg(d ORDER BY d.sort_order) FROM details d),'[]') AS rows,
      COALESCE((SELECT jsonb_agg(names.facilitator ORDER BY names.facilitator) FROM (
        SELECT DISTINCT school.facilitator FROM school_facilitators school JOIN matching person
          ON school.venue=person.venue_name AND school.npsn=ANY(string_to_array(replace(person.npsn,' ',''),';'))
        WHERE nullif(trim(school.facilitator),'') IS NOT NULL
      ) names),'[]'::jsonb) AS facilitators,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'name',l.name) ORDER BY l.name) FROM active_owners l
        WHERE ($2::int IS NULL OR l.venue_id=$2)),'[]') AS owners,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'name',v.name) ORDER BY v.name) FROM venues v),'[]') AS venues`,
    [term, venueId, limit, (page - 1) * limit, req.user.lo, req.user.venue, positionFilter,
      ['present', 'arrived', 'queued', 'unrecorded'].includes(req.query.arrival) ? req.query.arrival : '', testSessionId, ownerId, attendanceFilter, facilitatorFilter]);
  res.json({
    total: list.total, limit, current_lo_id: req.user.lo, venues: list.venues, owners: list.owners, facilitators: list.facilitators, arrival_summary: list.arrival_summary,
    rows: list.rows.map(({ recorded, phone, sort_order, ...person }) => ({
      ...person,
      session: withReportingDay(person.session),
      code: person.can_check_in ? person.code : undefined,
      can_check_in: req.user.role === 'lo' && person.can_check_in,
      phone: person.can_check_in && /^(bendahara|pengawas|fasil(?:itator)?(?:\s|$))/i.test(person.position || '') ? phone : undefined,
      unavailable: recorded?.status === 'berhalangan',
      unavailable_record: recorded?.status === 'berhalangan' ? recorded : null,
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
    `SELECT id, name, type, starts_at, is_test FROM sessions s WHERE (NOT s.is_test OR $3::int IS NOT NULL)
     AND role IN ($1,'semua') AND now() BETWEEN starts_at AND ends_at
     AND ${sessionApplies('$2::int')} AND ($3::int IS NULL OR id=$3)
     ORDER BY starts_at, id LIMIT 1`, [person.role, venueId, requestedSession]);
  if (!sessionRow) throw new HttpError(400, 'Tidak ada sesi yang dibuka untuk peserta dan venue ini.', { person: brief });
  const session = withReportingDay(sessionRow);

  const method = token ? 'qr' : 'manual';
  const status = unavailable ? 'berhalangan' : 'valid';
  let note = null;
  let photo = null;
  if (unavailable) {
    note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note || note.length > 1000) throw new HttpError(400, 'Alasan berhalangan hadir wajib diisi, maksimal 1.000 karakter.', { person: brief });
  }
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
  if (existing && (unavailable || !['berhalangan','ditolak'].includes(existing.status) || existing.venue_id !== venueId
    || (existing.status === 'ditolak' && (method !== 'manual' || !photo)))) {
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
     WHERE s.id=$2 AND s.is_test=$13::boolean AND now() BETWEEN s.starts_at AND s.ends_at AND ${sessionApplies('$3::int')}
       AND EXISTS (SELECT 1 FROM people p WHERE p.id=$1 AND p.archived_at IS NULL AND ${canCheckInForLo('$12', '$3')})
     ON CONFLICT (person_id, session_id) DO UPDATE SET
       photo_history=attendance.photo_history || jsonb_build_array(jsonb_build_object(
         'photo_path',attendance.photo_path,'at',attendance.created_at,'status',attendance.status,
         'venue_id',attendance.venue_id,'method',attendance.method,'scanned_by',attendance.scanned_by,
         'participant_note',attendance.participant_note,'flags',attendance.flags)),
       status=EXCLUDED.status, flags=EXCLUDED.flags, method=EXCLUDED.method, scanned_by=EXCLUDED.scanned_by,
       ip=EXCLUDED.ip, user_agent=EXCLUDED.user_agent, photo_path=EXCLUDED.photo_path,
       lat=NULL,lng=NULL,accuracy_m=NULL,distance_m=NULL,risk_score=0,samples=NULL,device_id=NULL,client_time=NULL,
       participant_note=EXCLUDED.participant_note, created_at=EXCLUDED.created_at
     WHERE (attendance.status='berhalangan' OR (attendance.status='ditolak' AND EXCLUDED.method='manual' AND EXCLUDED.photo_path IS NOT NULL))
       AND EXCLUDED.status='valid'
       AND attendance.venue_id IS NOT DISTINCT FROM EXCLUDED.venue_id
     RETURNING created_at`,
    [person.id, session.id, venueId, status,
      JSON.stringify(unavailable ? [] : [{ code: 'qr_lo', detail: `${method === 'qr' ? 'Dipindai' : 'Diabsenkan'} oleh ${scannedBy}` }]),
      method, scannedBy, clientIp(req), String(req.get('user-agent') || '').slice(0, 300), photoPath, note, req.user.lo, session.is_test]
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
// Read-only venue recap: LO can inspect the venue totals without gaining
// verification, editing, or deletion privileges over another LO's records.
r.get('/sessions/:id/status-details', ah(async (req, res) => {
  const sessionId = Number(req.params.id);
  const status = req.query.status;
  if (!Number.isSafeInteger(sessionId) || sessionId < 1 || sessionId > 2147483647
    || !['valid','review','ditolak','berhalangan','blocked'].includes(status)) {
    throw new HttpError(400, 'Sesi atau status absensi tidak valid.');
  }
  if (req.user.no_assignment) throw new HttpError(403, 'Belum ada penugasan pada tahap ini.');
  const venueId = scopeVenue(req);
  const limit = finiteInteger(req.query.limit, 50, 1, 100);
  const offset = finiteInteger(req.query.offset, 0, 0, 1000000);
  const blocked = status === 'blocked';
  const table = blocked ? 'attempt_logs' : 'attendance';
  const where = `a.session_id=$1 AND ($2::int IS NULL OR a.venue_id=$2)${blocked ? '' : ' AND a.status=$3'}`;
  const params = blocked ? [sessionId, venueId] : [sessionId, venueId, status];
  const [{ rows }, { rows: [summary] }] = await Promise.all([
    q(`SELECT a.id,a.created_at,${blocked ? 'a.reasons' : 'a.flags,a.scanned_by,a.participant_note'},
       p.name,p.code,p.position,p.institution,v.name AS venue_name,
       arrival.representatives->p.id::text AS representative
       FROM ${table} a LEFT JOIN people p ON p.id=a.person_id LEFT JOIN venues v ON v.id=a.venue_id
       LEFT JOIN venue_arrival_recap arrival ON arrival.venue_id=a.venue_id
       WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
    [...params, limit, offset]),
    q(`SELECT count(*)::int AS total FROM ${table} a WHERE ${where}`, params),
  ]);
  res.json({ rows, total: summary.total, limit, offset });
}));

r.get('/reporting/attendance-ranking', ah(async (req, res) => {
  const detail = req.query.owner_id !== undefined;
  const ownerId = detail ? Number(req.query.owner_id) : null;
  const metric = req.query.metric;
  if (detail && (!Number.isInteger(ownerId) || ownerId < 1 || ownerId > 2147483647 || !['assigned','present','completed','target','unavailable','participants','facilitators'].includes(metric))) throw new HttpError(400,'Rincian peringkat tidak valid.');
  if (detail && req.user.role === 'lo' && ownerId !== req.user.lo) throw new HttpError(403,'Rincian hanya tersedia untuk binaan Anda.');
  const sessionId = req.query.session_id == null || req.query.session_id === '' ? null : Number(req.query.session_id);
  if (sessionId !== null && (!Number.isInteger(sessionId) || sessionId < 1 || sessionId > 2147483647)) {
    throw new HttpError(400, 'Sesi absensi tidak valid.');
  }
  if (sessionId !== null) {
    const { rows: sessions } = await q('SELECT id FROM sessions WHERE id=$1 AND NOT is_test', [sessionId]);
    if (!sessions.length) throw new HttpError(400, 'Sesi resmi tidak ditemukan.');
  }
  const { rows } = await q(`WITH owners AS (
    SELECT l.id,l.name,l.venue_id,v.name AS venue,
      count(*) OVER (PARTITION BY l.venue_id,l.name) AS same_name
    FROM lo_accounts l JOIN venues v ON v.id=l.venue_id
  ), targets AS (
    SELECT DISTINCT l.id AS owner_id,p.id AS person_id
    FROM assignment_roster r
    CROSS JOIN LATERAL jsonb_each(r.data->'attendance_assignments') entries
    JOIN owners l ON entries.key=l.id::text
    CROSS JOIN LATERAL jsonb_to_recordset(entries.value) AS m(code text,name text,position text,npsn text,venue_id int)
    JOIN people p ON p.venue_id=l.venue_id AND p.venue_id=m.venue_id AND p.role='peserta'
      AND lower(trim(m.position))=lower(trim(p.position))
      AND ${nameKeySql('m.name')}=${nameKeySql('p.name')}
      AND (lower(m.code)=lower(p.code) OR (m.npsn IS NOT NULL
        AND string_to_array(replace(m.npsn,' ',''),';') && string_to_array(replace(p.npsn,' ',''),';')))
    WHERE r.id=1 AND p.archived_at IS NULL
      AND (lower(trim(p.position)) IN ('bendahara','pengawas','kepala sekolah') OR lower(trim(p.position)) ~ '^(verifikator|fasil(itator)?)($|[[:space:]])')
      AND ($1::int IS NULL OR EXISTS (SELECT 1 FROM sessions selected WHERE selected.id=$1 AND selected.role IN ('peserta','semua') AND (cardinality(COALESCE(selected.venue_ids,'{}'))=0 OR p.venue_id=ANY(selected.venue_ids))))
  ), presence AS MATERIALIZED (
    SELECT DISTINCT a.person_id,a.venue_id FROM attendance a JOIN sessions s ON s.id=a.session_id
    WHERE NOT s.is_test AND a.status IN ('valid','review') AND ($1::int IS NULL OR s.id=$1)
  ), presence_flags AS MATERIALIZED (
    SELECT t.owner_id,t.person_id,
      (evidence.person_id IS NOT NULL) AS present
    FROM targets t JOIN owners owner ON owner.id=t.owner_id
    LEFT JOIN presence evidence ON evidence.person_id=t.person_id AND evidence.venue_id=owner.venue_id
  ), presence_counts AS (
    SELECT owner_id,count(*) FILTER (WHERE present)::int AS present FROM presence_flags GROUP BY owner_id
  ), work AS MATERIALIZED (
    SELECT DISTINCT ON (a.scanned_by,a.venue_id,a.person_id) a.*
    FROM attendance a JOIN sessions s ON s.id=a.session_id
    WHERE NOT s.is_test AND ($1::int IS NULL OR s.id=$1)
      AND a.method IN ('manual','qr') AND a.status IN ('valid','review','berhalangan')
    ORDER BY a.scanned_by,a.venue_id,a.person_id,CASE WHEN a.status='berhalangan' THEN 1 ELSE 0 END,a.created_at DESC
  )
  ${detail ? `SELECT p.id,p.name,p.institution,p.position,p.npsn,l.venue,
    COALESCE(pf.present,false) AS present,a.status,a.created_at,a.participant_note
    FROM targets t JOIN owners l ON l.id=t.owner_id JOIN people p ON p.id=t.person_id
    LEFT JOIN presence_flags pf ON pf.owner_id=t.owner_id AND pf.person_id=t.person_id
    LEFT JOIN work a ON l.same_name=1 AND a.venue_id=l.venue_id AND a.person_id=p.id AND a.scanned_by='LO '||l.name
    WHERE l.id=$2 AND (${({
      assigned:'true',present:'COALESCE(pf.present,false)',completed:'a.id IS NOT NULL',
      target:'true',unavailable:"a.status='berhalangan'",
      participants:"a.id IS NOT NULL AND a.status<>'berhalangan' AND lower(trim(p.position)) IN ('bendahara','pengawas','kepala sekolah')",
      facilitators:"a.id IS NOT NULL AND a.status<>'berhalangan' AND lower(trim(p.position)) ~ '^(verifikator|fasil(itator)?)($|[[:space:]])'",
    })[metric]}) ORDER BY p.name,p.id` : `SELECT l.id,l.name,l.venue,
    (SELECT count(*)::int FROM targets t WHERE t.owner_id=l.id) AS assigned,
    COALESCE((SELECT present FROM presence_counts pc WHERE pc.owner_id=l.id),0) AS present,
    count(DISTINCT p.id) FILTER (WHERE a.status<>'berhalangan' AND lower(trim(p.position)) IN ('bendahara','pengawas','kepala sekolah'))::int AS participants,
    count(DISTINCT p.id) FILTER (WHERE a.status<>'berhalangan' AND lower(trim(p.position)) ~ '^(verifikator|fasil(itator)?)($|[[:space:]])')::int AS facilitators,
    count(DISTINCT p.id) FILTER (WHERE a.status<>'berhalangan')::int AS total,
    count(DISTINCT p.id) FILTER (WHERE a.status='berhalangan')::int AS unavailable,
    count(DISTINCT p.id) FILTER (WHERE a.status='berhalangan' AND EXISTS (
      SELECT 1 FROM presence_flags pf WHERE pf.owner_id=l.id AND pf.person_id=p.id AND NOT pf.present
    ))::int AS unavailable_absent
  FROM owners l
  LEFT JOIN work a ON l.same_name=1 AND a.venue_id=l.venue_id AND a.scanned_by='LO '||l.name
    AND a.method IN ('manual','qr') AND a.status IN ('valid','review','berhalangan')
    AND EXISTS (SELECT 1 FROM sessions s WHERE s.id=a.session_id AND NOT s.is_test
      AND ($1::int IS NULL OR s.id=$1))
  LEFT JOIN people p ON p.id=a.person_id AND p.role='peserta'
    AND EXISTS (SELECT 1 FROM targets t WHERE t.owner_id=l.id AND t.person_id=p.id)
    AND (lower(trim(p.position)) IN ('bendahara','pengawas','kepala sekolah') OR lower(trim(p.position)) ~ '^(verifikator|fasil(itator)?)($|[[:space:]])')
  GROUP BY l.id,l.name,l.venue
  ORDER BY total DESC,l.name,l.id`}`, detail ? [sessionId,ownerId] : [sessionId]);
  res.json(rows);
}));

const attendancePositions = {
  lo: "lower(trim(p.position))='lo'",
  bendahara: "lower(trim(p.position))='bendahara'",
  pengawas: "lower(trim(p.position)) IN ('pengawas','kepala sekolah')",
  fasil: "lower(trim(p.position)) ~ '^(verifikator|fasil(itator)?)($|[[:space:]])'",
  dinas: "lower(trim(p.position))='dinas pendidikan'",
  bpmp: "lower(trim(p.position))='bb/bpmp'",
};
function attendancePositionFilter(req) {
  const position = req.query.position;
  const role = req.query.role;
  if (role && !['peserta', 'panitia'].includes(role)) throw new HttpError(400, 'Filter Peserta/Panitia tidak valid.');
  if (position && (typeof position !== 'string' || !Object.hasOwn(attendancePositions, position))) {
    throw new HttpError(400, 'Filter jabatan tidak valid.');
  }
  return `(${position ? attendancePositions[position] : 'true'}) AND (${role ? `p.role='${role}'` : 'true'})`;
}
function attendanceSearch(req) {
  if (req.query.q != null && typeof req.query.q !== 'string') throw new HttpError(400, 'Pencarian tidak valid.');
  const term = (req.query.q || '').trim().slice(0, 150);
  return term ? '%' + term.replace(/[\\%_]/g, '\\$&') + '%' : '';
}
/** Daftar absen per sesi, dengan halaman (default 48 per halaman) agar ringan. */
const attendanceOrders = {
  risk: 'a.risk_score DESC, a.created_at DESC, a.id DESC',
  newest: 'a.created_at DESC, a.id DESC',
  oldest: 'a.created_at ASC, a.id ASC',
  name_asc: 'lower(p.name) ASC, a.id ASC',
  name_desc: 'lower(p.name) DESC, a.id DESC',
  venue_asc: 'lower(v.name) ASC NULLS LAST, lower(p.name) ASC, a.id ASC',
  venue_desc: 'lower(v.name) DESC NULLS LAST, lower(p.name) ASC, a.id ASC',
};
async function attendanceSessionScope(req) {
  const id = Number(req.query.session_id);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw new HttpError(400, 'Sesi absensi tidak valid.');
  const { rows: [session] } = await q('SELECT * FROM sessions WHERE id=$1', [id]);
  if (!session) throw new HttpError(404, 'Sesi absensi tidak ditemukan pada kegiatan ini. Pilih sesi yang sesuai.');
  if (eventId() !== 5 || req.query.combine_day !== 'true' || session.is_test) return { session, ids: [id] };
  const { rows } = await q(`SELECT id FROM sessions WHERE NOT is_test
    AND (starts_at AT TIME ZONE 'Asia/Jakarta')::date=($1::timestamptz AT TIME ZONE 'Asia/Jakarta')::date ORDER BY starts_at,id`, [session.starts_at]);
  return { session, ids: rows.map(row => row.id) };
}

r.get('/attendance', ah(async (req, res) => {
  const ownOnly = req.user.role === 'lo';
  if (ownOnly && !req.user.lo) throw new HttpError(403, 'Belum ada penugasan pada tahap ini.');
  const sort = req.query.sort ?? 'risk';
  if (typeof sort !== 'string' || !Object.hasOwn(attendanceOrders, sort)) throw new HttpError(400, 'Urutan absensi tidak valid.');
  const { ids: sessionIds } = await attendanceSessionScope(req);
  const v = scopeVenue(req);
  const recordedBy = ownOnly ? `LO ${req.user.name}` : typeof req.query.recorded_by === 'string' ? req.query.recorded_by.trim().slice(0, 300) : '';
  const status = ['valid', 'review', 'ditolak', 'berhalangan'].includes(req.query.status) ? req.query.status : null;
  const limit = finiteInteger(req.query.limit, 48, 1, 200);
  const offset = finiteInteger(req.query.offset, 0, 0, 1000000);
  const positionFilter = attendancePositionFilter(req);
  const search = attendanceSearch(req);
  const where = `a.session_id=ANY($1::int[]) AND ($2::int IS NULL OR a.venue_id=$2)
    AND EXISTS (SELECT 1 FROM people p WHERE p.id=a.person_id AND ${positionFilter}
      AND ($8::text='' OR p.name ILIKE $8 OR p.npsn ILIKE $8 OR EXISTS (
        SELECT 1 FROM venue_arrival_recap arrival WHERE arrival.venue_id=a.venue_id
          AND arrival.representatives->p.id::text->>'name' ILIKE $8)))
    AND ($9::int IS NULL OR (a.method IN ('manual','qr') AND NOT EXISTS (
      SELECT 1 FROM lo_accounts other JOIN lo_accounts own ON own.id=$9
      WHERE other.id<>own.id AND other.venue_id=own.venue_id AND other.name=own.name)))`;
  const [{ rows }, { rows: [summary] }] = await Promise.all([
    q(
      `SELECT a.id, a.status, a.risk_score, a.flags, a.lat, a.lng, a.accuracy_m, a.distance_m,
              a.created_at, a.device_id, a.user_agent, a.ip, a.photo_path, a.photo_history, a.venue_id, a.method, a.scanned_by, a.participant_note,
              p.name, p.code, p.role, p.institution, p.position, v.name AS venue_name,
              arrival.representatives->p.id::text AS representative,
              ${assignedToLo('$6', '$2')} AS can_verify,
              ${canDeleteAttendance('$6', '$2')} AS can_delete,
              (($6::int IS NULL OR a.venue_id=$2::int)
                AND ${canCheckInForLo('$6', '$2')}) AS can_edit_note
       FROM attendance a JOIN people p ON p.id=a.person_id LEFT JOIN venues v ON v.id=a.venue_id
       LEFT JOIN venue_arrival_recap arrival ON arrival.venue_id=a.venue_id
       WHERE ${where} AND ($3::text IS NULL OR a.status=$3) AND ($7::text='' OR a.scanned_by=$7)
       ORDER BY ${attendanceOrders[sort]}
       LIMIT $4 OFFSET $5`,
      [sessionIds, v, status, limit, offset, req.user.lo, recordedBy, search, ownOnly ? req.user.lo : null]
    ),
    q(
      `SELECT EXISTS (SELECT 1 FROM sessions WHERE id=ANY($1::int[])) AS session_exists,
              count(*)::int AS total,
              count(*) FILTER (WHERE a.status='valid')::int AS valid,
              count(*) FILTER (WHERE a.status='review')::int AS review,
              count(*) FILTER (WHERE a.status='ditolak')::int AS ditolak,
              count(*) FILTER (WHERE a.status='berhalangan')::int AS berhalangan,
              ARRAY(SELECT DISTINCT recorder.scanned_by FROM attendance recorder
                WHERE recorder.session_id=ANY($1::int[]) AND ($2::int IS NULL OR recorder.venue_id=$2)
                  AND recorder.method IN ('manual','qr') AND recorder.scanned_by IS NOT NULL
                ORDER BY recorder.scanned_by) AS recorders
       FROM attendance a WHERE ${where.replaceAll('$8', '$4').replaceAll('$9', '$5')} AND ($3::text='' OR a.scanned_by=$3)`,
      [sessionIds, v, recordedBy, search, ownOnly ? req.user.lo : null]
    ),
  ]);
  const { recorders, session_exists: sessionExists, ...c } = summary;
  if (!sessionExists) throw new HttpError(404, 'Sesi absensi tidak ditemukan pada kegiatan ini. Pilih sesi yang sesuai.');
  // Signed URL R2 hanya untuk foto di halaman ini (bukan semua foto sesi)
  const out = await Promise.all(rows.map(async ({ photo_path, photo_history, ...x }) => ({ ...x,
    photo_history: photo_history.map(({photo_path,...version}) => ({...version,has_photo:!!photo_path})),
    photo_url: photo_path ? await photoUrl(photo_path) : null, has_photo: !!photo_path })));
  res.json({
    rows: ownOnly ? out.map(({ ip, device_id, user_agent, ...row }) => ({ ...row,
      can_retry: row.status === 'ditolak' && row.role === 'peserta' && row.can_edit_note,
      can_verify: row.role === 'peserta' && row.status !== 'berhalangan',
      can_delete: row.role === 'peserta', can_edit_note: row.role === 'peserta' })) : out,
    recorders: ownOnly ? [] : recorders,
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

r.patch('/attendance/:id/note', ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) throw new HttpError(400, 'ID absensi tidak valid.');
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  if (!note || note.length > 1000) throw new HttpError(400, 'Catatan wajib diisi, maksimal 1.000 karakter.');
  const { rows: [updated] } = await q(
    `UPDATE attendance a SET participant_note=$1 FROM people p
     WHERE a.id=$2 AND p.id=a.person_id
       AND ${recordedByLo('$3', '$4')}
     RETURNING a.id, a.participant_note`, [note, id, req.user.lo, req.user.venue]);
  if (!updated) throw new HttpError(404, 'Absensi tidak ditemukan atau catatannya tidak dapat Anda ubah.');
  res.json(updated);
}));

r.patch('/attendance/:id', ah(async (req, res) => {
  if (req.user.role === 'lo' && req.body?.status !== 'ditolak') throw new HttpError(403, 'LO hanya dapat menolak absensi yang dicatatnya sendiri.');
  if (!['valid', 'review', 'ditolak'].includes(req.body?.status)) throw new HttpError(400, 'Status tidak valid');
  await assertOwnAttendance(req, req.params.id);
  const { rows } = await q(
    `UPDATE attendance a SET status=$1 FROM people p
     WHERE a.id=$2 AND p.id=a.person_id AND a.status<>'berhalangan'
       AND ${recordedByLo('$3', '$4')}
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
     WHERE a.id=$1 AND p.id=a.person_id AND ${recordedByLo('$2', '$3')}
     RETURNING a.photo_path,a.photo_history`,
    [id, req.user.lo, req.user.venue]
  );
  if (!deleted) throw new HttpError(404, 'Absensi tidak ditemukan atau tidak dapat Anda hapus.');
  await deletePhoto(deleted.photo_path);
  for (const version of deleted.photo_history) await deletePhoto(version.photo_path);
  res.sendStatus(204);
}));

r.get('/attempts', requireSuper, ah(async (req, res) => {
  const v = scopeVenue(req);
  const positionFilter = attendancePositionFilter(req);
  const { rows } = await q(
    `SELECT l.id, l.reasons, l.lat, l.lng, l.accuracy_m, l.distance_m, l.created_at,
            p.name, p.code, p.role, v.name AS venue_name
     FROM attempt_logs l LEFT JOIN people p ON p.id=l.person_id LEFT JOIN venues v ON v.id=l.venue_id
     WHERE l.session_id=$1 AND ($2::int IS NULL OR l.venue_id=$2) AND (${positionFilter})
     ORDER BY l.created_at DESC LIMIT 500`, [req.query.session_id, v]);
  res.json(rows);
}));

r.get('/photo/:id', ah(async (req, res) => {
  if (!/^\d{1,10}$/.test(req.params.id) || Number(req.params.id) > 2147483647) throw new HttpError(404, 'Foto tidak ditemukan.');
  await assertOwnAttendance(req, req.params.id);
  const { rows } = await q('SELECT photo_path,photo_history FROM attendance WHERE id=$1', [req.params.id]);
  if (req.query.version !== undefined) {
    if (typeof req.query.version !== 'string' || !/^\d{1,6}$/.test(req.query.version) || !rows[0]?.photo_history[Number(req.query.version)]) throw new HttpError(404, 'Foto tidak ditemukan.');
    rows[0].photo_path = rows[0].photo_history[Number(req.query.version)].photo_path;
  }
  if (!rows[0]?.photo_path) return res.status(404).end();
  if (req.query.bytes === 'true') {
    res.set('Cache-Control', 'no-store');
    return res.type('image/jpeg').send(await readPhoto(rows[0].photo_path));
  }
  const url = await photoUrl(rows[0].photo_path, 600);
  if (url) return res.redirect(302, url);
  if (!fs.existsSync(rows[0].photo_path)) return res.status(404).end();
  res.set('Cache-Control', 'no-store');
  res.sendFile(rows[0].photo_path);
}));

/**
 * CSV bawaan berisi absensi valid dan perlu dicek.
 * include_all=true menambahkan peserta yang belum absen dan status lainnya.
 */
r.get('/export', ah(async (req, res) => {
  const search = attendanceSearch(req);
  const v = scopeVenue(req);
  const exportStatus = ['valid', 'review', 'ditolak', 'berhalangan'].includes(req.query.status) ? req.query.status : null;
  const recordedBy = typeof req.query.recorded_by === 'string' ? req.query.recorded_by.trim().slice(0, 300) : '';
  const positionFilter = attendancePositionFilter(req);
  const { session: s, ids: sessionIds } = await attendanceSessionScope(req);
  const { rows } = await q(
    `WITH ${attendanceExportLoCtes}
     SELECT p.name, p.role, p.institution, p.position, pv.name AS assigned_venue,
            p.npsn, p.provinsi, p.kab_kota, p.ptn,
            assigned.assigned_lo,
            a.id AS attendance_id, a.photo_path IS NOT NULL AS has_photo,
            a.status, a.created_at, av.name AS venue, a.flags, a.method, a.participant_note
     FROM people p
     LEFT JOIN export_assigned_lo assigned ON assigned.person_id=p.id
     LEFT JOIN venues pv ON pv.id=p.venue_id
     LEFT JOIN attendance a ON a.person_id=p.id AND a.session_id=ANY($1::int[])
     LEFT JOIN venues av ON av.id=a.venue_id
     WHERE (${positionFilter}) AND ($4::text='' OR a.scanned_by=$4) AND ($5::text IS NULL OR a.status=$5)
       AND ($7::text='' OR p.name ILIKE $7 OR p.npsn ILIKE $7)
       AND ((a.id IS NOT NULL AND ($3::boolean OR $6::boolean OR a.status IN ('valid','review')) AND ($2::int IS NULL OR a.venue_id=$2))
        OR ($3::boolean AND a.id IS NULL AND EXISTS (SELECT 1 FROM sessions scope
            WHERE scope.id=ANY($1::int[]) AND (scope.role='semua' OR p.role=scope.role)
              AND ${inRosterAt('LEAST(now(), scope.ends_at)')}
              AND (cardinality(COALESCE(scope.venue_ids,'{}'))=0 OR p.venue_id IS NULL OR p.venue_id=ANY(scope.venue_ids)))
            AND ($2::int IS NULL OR p.venue_id IS NULL OR p.venue_id=$2)))
     ORDER BY p.role, p.name`,
    [sessionIds, v, req.query.include_all === 'true', recordedBy, exportStatus, req.query.recorded_only === 'true', search]
  );
  let venueName = '';
  if (v) venueName = (await q('SELECT name FROM venues WHERE id=$1', [v])).rows[0]?.name || '';
  const esc = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const safeNote = (note) => note && /^(?:\s*[=+@-]|[\t\r\n])/.test(note) ? "'" + note : note;
  const fmt = (d) => d ? new Date(d).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '';
  const header = ['Nama', 'Peran', 'Instansi / Sekolah', 'Jabatan', 'NPSN', 'Provinsi',
    'Kab/Kota', 'PTN', 'Venue Ditetapkan', 'LO Bertugas', 'Status Absensi', 'Metode',
    'Waktu (WIB)', 'Venue Absen', 'Catatan', 'Catatan peserta / Alasan berhalangan', 'URL Foto'];
  const host = req.get('host');
  const origin = /^(?:[\w.-]+|\[[0-9a-f:]+\])(?::\d+)?$/i.test(host || '') ? `${req.secure ? 'https' : 'http'}://${host}` : '';
  const lines = rows.map((x) => [
    x.name, x.role, x.institution, x.position, x.npsn, x.provinsi,
    x.kab_kota, x.ptn, x.assigned_venue || 'Semua', safeNote(x.assigned_lo) || '',
    ({ valid: 'Sudah absen', review: 'Sudah absen', berhalangan: 'Mundur/Berhalangan Hadir', ditolak: 'Absensi ditolak' })[x.status] || 'Belum absen',
    ({ qr: 'Scan QR (LO)', manual: 'Diabsenkan LO', selfie: 'Selfie + GPS' })[x.method] || '',
    fmt(x.created_at), x.venue || '',
    (x.flags || []).map((f) => f.detail).join('; '),
    safeNote(x.participant_note),
    x.has_photo && origin ? `${origin}/admin/absensi/foto/${x.attendance_id}?event=${eventId()}` : '',
  ].map(esc).join(','));
  const day = withReportingDay(s).check_in_day;
  const title = day ? `${day.label} ${day.date}` : `absensi-${s.name}`;
  const name = `${title}${venueName ? '-' + venueName : ''}`.replace(/[^\w-]+/g, '_') + '.csv';
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${name}"`);
  res.send('﻿' + [header.map(esc).join(','), ...lines].join('\r\n'));
}));

export default r;
