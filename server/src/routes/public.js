import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { savePhoto, deletePhoto, readPhoto } from '../storage.js';
import { q, getSettings } from '../db.js';
import { ah, HttpError, haversine, clientIp } from '../util.js';
import { requireAdmin, requireLo, signChallenge, verifyChallenge } from '../auth.js';
import { sanitizeSamples, analyzeLocation, analyzeClientMeta, scoreOf, locate, compactSamples } from '../antifake.js';
import { reportingDates, reportingDays, withReportingDay } from '../reportingDays.js';
import { getPublicReporting } from '../reporting.js';
import { getVenueAttendance, getVenueAttendanceDetails } from '../venueAttendance.js';
import { getArrivalRecap } from '../arrivalRecap.js';
import { getVerval } from '../verval.js';
import { publicReadLimiter, vervalLimiter, schoolDetailLimiter } from '../security.js';
import { createAsyncCache } from '../asyncCache.js';
import { currentEvent, eventId } from '../eventContext.js';
import { getLoProfile as resolveLoProfile } from '../loProfile.js';

const r = Router();
const ROLES = ['peserta', 'panitia'];
const PUBLIC_SELF_CHECK_IN_ENABLED = false;
const publicAttendanceGroups = ['bendahara','pengawas','fasil','lo'];
const publicCache = createAsyncCache();
r.use('/dashboard', publicReadLimiter);
r.use('/info', publicReadLimiter);
r.use('/verval', vervalLimiter);
r.use('/verval/schools', schoolDetailLimiter);

r.get('/verval/overview', ah(async (req, res) => {
  const data = await getVerval('/overview');
  if (!data.meta || !data.prov || !Array.isArray(data.parts)) throw new HttpError(502, 'Format sumber Verval tidak valid.');
  res.json({ updated_at: data.meta.generated_at, provinces: data.prov, districts: data.kab,
    levels: data.meta.jenjang, parts: data.parts.map(({ j, p, n }) => ({ level: j, province: p, count: n })) });
}));

r.get('/verval/parts/:key', ah(async (req, res) => {
  const key = req.params.key;
  if (!/^(PAUD|SD|SMP|SMA|SMK|SLB|PNFI)-\d{2}$/.test(key)) throw new HttpError(400, 'Wilayah Verval tidak valid.');
  const data = await getVerval(`/parts/${key}`);
  res.json({ rows: data.rows.map((row) => ({ ...row, jenjang: data.j })) });
}));

r.get('/verval/schools/:npsn', ah(async (req, res) => {
  if (!/^[A-Za-z0-9_-]{4,24}$/.test(req.params.npsn)) throw new HttpError(400, 'NPSN tidak valid.');
  res.json(await getVerval(`/schools/${encodeURIComponent(req.params.npsn)}`));
}));

r.get('/dashboard/absensi/:venueId/participants', ah(async (req, res) => {
  const venueId = Number(req.params.venueId);
  const { group, period, scope = 'all' } = req.query;
  if (!Number.isInteger(venueId) || venueId < 1 || venueId > 2147483647 || !publicAttendanceGroups.includes(group)
    || !reportingDates.includes(period) || !['all','checked_in'].includes(scope)) throw new HttpError(400, 'Filter absensi tidak valid.');
  const entries = await getVenueAttendanceDetails(venueId, group, period);
  const rows = entries.map((entry) => ({ name: entry.name, institution: entry.institution || '',
    checked_in: entry.people.some((person) => ['valid','review'].includes(person.status)) }));
  res.json(scope === 'checked_in' ? rows.filter((row) => row.checked_in) : rows);
}));

r.get('/dashboard/:section', ah(async (req, res) => {
  const { section } = req.params;
  const { period } = req.query;
  if (!['pelaporan','absensi','kehadiran'].includes(section)) throw new HttpError(404, 'Ringkasan tidak ditemukan.');
  if (period !== undefined && (typeof period !== 'string' || period.length > 32)) throw new HttpError(400, 'Periode tidak valid.');
  const result = await publicCache.get(JSON.stringify([eventId(), section, period ?? null]), async () => {
  let rows;
  if (section === 'pelaporan') {
    rows = await getPublicReporting(period ?? 'current');
  } else if (section === 'absensi') {
    if (!reportingDates.length) return { updated_at: null, rows: [] };
    const day = period ?? reportingDates[0];
    if (!reportingDates.includes(day)) throw new HttpError(400, 'Hari absensi tidak valid.');
    const [venues, { rows: [latest] }] = await Promise.all([
      getVenueAttendance(null, day),
      q(`SELECT max(a.created_at) AS updated_at FROM attendance a JOIN sessions s ON s.id=a.session_id
        WHERE NOT s.is_test AND (s.starts_at AT TIME ZONE 'Asia/Jakarta')::date=$1::date`, [day]),
    ]);
    rows = { updated_at: latest.updated_at, rows: venues.map(({ name: venue, id, ...groups }) => ({
      venue, id,
      breakdown: Object.fromEntries(Object.entries(groups).filter(([key]) => publicAttendanceGroups.includes(key)).map(([key, { total, attended }]) =>
        [key, { target: total, checked_in: attended }])),
      counts: Object.entries(groups).filter(([key]) => publicAttendanceGroups.includes(key)).map(([, group]) => group).reduce((counts, group) => ({
        target: counts.target + group.total,
        checked_in: counts.checked_in + group.attended,
      }), { target: 0, checked_in: 0 }),
    })) };
  } else if (section === 'kehadiran') {
    const venues = await getArrivalRecap();
    rows = {
      updated_at: venues.reduce((latest, venue) =>
        venue.imported_at && (!latest || venue.imported_at > latest) ? venue.imported_at : latest, null),
      rows: venues.map(({ name: venue, invited, arrived, queued, source_ready, breakdown }) => ({
      venue, counts: source_ready ? { invited, arrived, queued } : null,
      breakdown: breakdown.map(({ position, invited, arrived, queued }) => ({ position, invited, arrived, queued })),
      })),
    };
  } else {
    throw new HttpError(404, 'Ringkasan tidak ditemukan.');
  }
  return rows;
  });
  res.set('Cache-Control', 'no-store');
  res.json(result);
}));

if (!PUBLIC_SELF_CHECK_IN_ENABLED) {
  r.post(['/npsn', '/challenge', '/precheck', '/attendance', '/riwayat'], (_req, res) =>
    res.status(403).json({ error: 'Pencatatan kehadiran peserta dilakukan oleh LO di venue kegiatan.' }));
}

// Ratusan peserta memakai WiFi venue yang sama = satu IP publik (NAT),
// jadi batas per-IP dibuat longgar (hanya menahan bot/brute force kasar).
// Batas yang sebenarnya dihitung per orang di database (lihat /attendance).
// Catatan: di Vercel penghitung ini per-instance (best effort).
const ipLimiter = rateLimit({ windowMs: 60_000, limit: Number(process.env.IP_RATE_LIMIT || 2000),
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Server sedang sangat sibuk, coba lagi dalam 1 menit.' } });
const MAX_FAILED_PER_PERSON = 10; // percobaan ditolak per orang per 10 menit

async function activeSession(role, venue, allowTest = false) {
  const { rows } = await q(
    `SELECT * FROM sessions
     WHERE (NOT is_test OR $3::boolean) AND role IN ($1,'semua') AND now() BETWEEN starts_at AND ends_at
       AND ($2::int IS NULL OR cardinality(COALESCE(venue_ids,'{}'))=0 OR $2=ANY(venue_ids))
     ORDER BY is_test, starts_at, id LIMIT 1`,
    [role, venue, allowTest]
  );
  return rows[0];
}

/** Venue yang boleh dipakai: venue aktif ∩ venue sesi (bila dibatasi) ∩ venue orang (bila dikunci). */
async function allowedVenues(person, session) {
  const { rows } = await q(
    `SELECT * FROM venues
     WHERE active
       AND (cardinality(COALESCE($1::int[], '{}')) = 0 OR id = ANY($1::int[]))
       AND ($2::int IS NULL OR id = $2)
     ORDER BY name`,
    [session.venue_ids, person.venue_id]
  );
  return rows;
}

const publicSession = (s) => s && withReportingDay({ name: s.name, type: s.type, role: s.role, starts_at: s.starts_at, ends_at: s.ends_at, is_test: s.is_test });
const alreadyRecorded = (status) => status === 'berhalangan'
  ? 'Anda tercatat mundur/berhalangan hadir untuk sesi ini. Hubungi panitia jika status perlu diubah.'
  : 'Anda sudah absen untuk sesi ini.';
const isLoProfile = (person) => person.role === 'panitia' && /^(lo(?:\s|$)|liaison officer$)/i.test(person.position?.trim() || '');

r.get('/info', ah(async (req, res) => {
  const [s, { rows: venues }, { rows: sessions }] = await Promise.all([
    getSettings(),
    q('SELECT id, name, address, radius_m FROM venues WHERE active ORDER BY name'),
    // sesi yang sedang dibuka + sesi berikutnya hari ini/besok (untuk ditampilkan di beranda)
    q(`SELECT * FROM sessions WHERE NOT is_test AND ends_at > now() AND starts_at < now() + interval '36 hours'
       ORDER BY starts_at LIMIT 12`),
  ]);
  const now = Date.now();
  const forRole = (role) => {
    const list = sessions.filter((x) => x.role === role || x.role === 'semua');
    const open = list.find((x) => new Date(x.starts_at) <= now);
    const next = list.find((x) => new Date(x.starts_at) > now);
    return { open: publicSession(open), next: publicSession(next) };
  };
  res.json({
    event: { id: eventId(), name: currentEvent().name, status: currentEvent().status },
    event_name: s.event_name,
    organizer: s.organizer,
    event_dates: s.event_dates,
    venues: venues.map(({ id, ...v }) => v),
    sessions: { peserta: forRole('peserta'), panitia: forRole('panitia') },
    check_in_days: reportingDays,
    server_time: new Date().toISOString(),
  });
}));

// Kartu QR pribadi (link dikirim via WA). Token acak 32 karakter, tidak bisa ditebak.
r.get('/qr/:token', ipLimiter, ah(async (req, res) => {
  const token = String(req.params.token || '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(token)) throw new HttpError(404, 'QR tidak ditemukan');
  const { rows: [p] } = await q(
    `SELECT p.name, p.code, p.role, p.position, p.institution, p.ruangan, v.name AS venue
     FROM people p LEFT JOIN venues v ON v.id=p.venue_id WHERE p.qr_token=$1 AND p.archived_at IS NULL`, [token]);
  if (!p) throw new HttpError(404, 'QR tidak ditemukan atau sudah tidak berlaku. Hubungi panitia.');
  const s = await getSettings();
  res.json({ ...p, event_name: s.event_name });
}));

// Cari peserta lewat NPSN sekolah → pilih Bendahara / Pengawas / Kepala Sekolah
const NPSN_ROLES = [
  { key: 'bendahara', label: 'Bendahara', match: /bendahara/i },
  { key: 'pengawas', label: 'Pengawas', match: /pengawas/i },
  { key: 'kepsek', label: 'Kepala Sekolah', match: /kepala\s*sekolah|kepsek/i },
];
r.post('/npsn', ipLimiter, ah(async (req, res) => {
  const npsn = String(req.body?.npsn || '').replace(/\D/g, '');
  if (!/^\d{8}$/.test(npsn)) throw new HttpError(400, 'NPSN terdiri dari 8 digit angka.');
  const { rows } = await q(
    `SELECT code, name, position, institution, npsn FROM people
     WHERE role='peserta' AND archived_at IS NULL
       AND $1 = ANY(string_to_array(replace(COALESCE(npsn,''), ' ', ''), ';'))
     ORDER BY position, name`, [npsn]);
  if (!rows.length) throw new HttpError(404, 'NPSN tidak ditemukan di daftar peserta. Periksa kembali atau hubungi panitia.');
  // nama sekolah sesuai NPSN ini (pengawas menyimpan beberapa sekolah)
  const own = rows.find((r) => r.npsn === npsn) || rows[0];
  const idx = String(own.npsn || '').split('; ').indexOf(npsn);
  const school = idx >= 0 ? String(own.institution || '').split('; ')[idx] || own.institution : own.institution;
  const options = NPSN_ROLES.map(({ key, label, match }) => ({
    key, label, people: rows.filter((r) => match.test(r.position || '')).map(({ code, name }) => ({ code, name })),
  }));
  const other = rows.filter((r) => !NPSN_ROLES.some((x) => x.match.test(r.position || '')));
  if (other.length) options.push({ key: 'lain', label: 'Lainnya', people: other.map(({ code, name, position }) => ({ code, name, position })) });
  res.json({ npsn, school, options });
}));

// Langkah 1: verifikasi kode peserta/panitia → token absen berlaku singkat
r.post('/challenge', ipLimiter, ah(async (req, res) => {
  const { code, role } = req.body || {};
  if (!ROLES.includes(role)) throw new HttpError(400, 'Peran tidak valid');

  const input = String(code || '').trim();
  let { rows } = await q('SELECT * FROM people WHERE lower(code) = lower($1) AND archived_at IS NULL', [input]);
  // Kode NPSN boleh diketik tanpa tanda hubung (B20100001). Pengawas membawahi beberapa
  // sekolah: P-<NPSN sekolah mana pun> juga diterima.
  const m = !rows[0] && input.match(/^([BPK])\s*-?\s*(\d{6,10})$/i);
  if (m) {
    const letter = m[1].toUpperCase();
    ({ rows } = await q('SELECT * FROM people WHERE lower(code) = lower($1) AND archived_at IS NULL', [`${letter}-${m[2]}`]));
    if (!rows[0] && letter === 'P') {
      ({ rows } = await q(
        `SELECT * FROM people WHERE position ILIKE 'pengawas' AND archived_at IS NULL
         AND $1 = ANY(string_to_array(replace(npsn, ' ', ''), ';')) LIMIT 1`,
        [m[2]]));
    }
  }
  const person = rows[0];
  if (!person) throw new HttpError(404, 'Kode tidak terdaftar. Periksa kembali atau hubungi panitia.');
  if (person.role !== role) {
    throw new HttpError(400, `Kode ini terdaftar sebagai ${person.role}. Gunakan halaman absen ${person.role}.`);
  }
  if (isLoProfile(person)) throw new HttpError(403, 'Silakan masuk ke Dashboard LO dan buka Absen Saya.');

  res.json(await buildChallenge(person));
}));

async function getLoProfile(user) {
  return resolveLoProfile(user, q);
}

r.get('/lo/attendance', requireAdmin, requireLo, ah(async (req, res) => {
  const person = await getLoProfile(req.user);
  if (!person) throw new HttpError(404, 'Profil absensi LO belum terhubung. Hubungi Admin Utama.');
  const session = await activeSession(person.role, person.venue_id, true);
  const { rows } = await q(`SELECT a.id,a.session_id,a.status,a.created_at AS at,a.distance_m,
    a.photo_path IS NOT NULL AS has_photo,a.photo_history,p.name,v.name AS venue,s.name AS session,s.type AS session_type,s.is_test
    FROM attendance a JOIN people p ON p.id=a.person_id JOIN sessions s ON s.id=a.session_id
    JOIN venues v ON v.id=a.venue_id WHERE a.person_id=$1 ORDER BY a.created_at DESC,a.id DESC`, [person.id]);
  res.set('Cache-Control', 'no-store');
  res.json({ records: rows.map(({photo_history,...row}) => ({...row,photo_history:photo_history.map(({photo_path,...version}) => ({...version,has_photo:!!photo_path}))})), current_session_id: session?.id || null,
    recorded: rows.some((row) => row.session_id === session?.id && row.status !== 'ditolak'),
    retry: rows.some((row) => row.session_id === session?.id && row.status === 'ditolak') });
}));

r.get('/lo/attendance/:id/photo', requireAdmin, requireLo, ah(async (req, res) => {
  if (!/^\d{1,10}$/.test(req.params.id) || Number(req.params.id) > 2147483647) throw new HttpError(404, 'Foto tidak ditemukan.');
  const person = await getLoProfile(req.user);
  if (!person) throw new HttpError(404, 'Foto tidak ditemukan.');
  const { rows: [record] } = await q('SELECT photo_path,photo_history FROM attendance WHERE id=$1 AND person_id=$2', [req.params.id, person.id]);
  if (req.query.version !== undefined) {
    if (typeof req.query.version !== 'string' || !/^\d{1,6}$/.test(req.query.version) || !record?.photo_history[Number(req.query.version)]) throw new HttpError(404, 'Foto tidak ditemukan.');
    record.photo_path = record.photo_history[Number(req.query.version)].photo_path;
  }
  if (!record?.photo_path) throw new HttpError(404, 'Foto tidak ditemukan.');
  res.set('Cache-Control', 'no-store');
  res.type('image/jpeg').send(await readPhoto(record.photo_path));
}));

r.post('/lo/challenge', ipLimiter, requireAdmin, requireLo, ah(async (req, res) => {
  const person = await getLoProfile(req.user);
  if (!person) throw new HttpError(404, 'Profil absensi LO belum terhubung. Hubungi Admin Utama.');
  res.json(await buildChallenge(person, req.user));
}));

async function buildChallenge(person, loAccount) {
  const session = await activeSession(person.role, person.venue_id, !!loAccount);
  if (!session) throw new HttpError(400, 'Belum ada sesi absensi yang dibuka saat ini.');

  const venues = await allowedVenues(person, session);
  if (!venues.length) throw new HttpError(400, 'Belum ada venue untuk Anda di sesi ini. Hubungi panitia.');

  const done = await q('SELECT created_at, status FROM attendance WHERE person_id=$1 AND session_id=$2',
    [person.id, session.id]);
  if (done.rows[0] && !(loAccount && done.rows[0].status === 'ditolak')) {
    throw new HttpError(409, alreadyRecorded(done.rows[0].status), { at: done.rows[0].created_at, status: done.rows[0].status });
  }

  const nonce = crypto.randomInt(0, 10000).toString().padStart(4, '0');
  return {
    token: signChallenge(person.id, session.id, nonce, loAccount),
    nonce,
    person: {
      name: person.name, position: person.position, code: person.code, ruangan: person.ruangan,
      // pengawas bisa membawahi banyak sekolah → ringkas
      institution: (() => {
        const list = String(person.institution || '').split('; ').filter(Boolean);
        return list.length > 2 ? `${list.slice(0, 2).join('; ')} +${list.length - 2} sekolah` : person.institution;
      })(),
    },
    session: publicSession(session),
    venues: venues.map((v) => ({ name: v.name, address: v.address, radius_m: v.radius_m })),
  };
}

function attendanceChallenge(req, token) {
  const ch = verifyChallenge(token);
  if (!ch) throw new HttpError(req.user ? 410 : 401, 'Waktu absen habis. Silakan ulangi dari awal.');
  if ((ch.lo ?? null) !== (req.user?.lo ?? null) || (ch.lo != null && ch.venue !== req.user?.venue)) {
    throw new HttpError(403, 'Token absensi ini tidak berlaku untuk akun Anda.');
  }
  return ch;
}

async function challengePerson(req, ch) {
  if (ch.lo != null) {
    const person = await getLoProfile(req.user);
    if (person?.id === ch.p) return person;
    throw new HttpError(403, 'Profil absensi LO berubah. Silakan mulai ulang.');
  }
  const { rows: [person] } = await q('SELECT * FROM people WHERE id=$1 AND archived_at IS NULL', [ch.p]);
  if (person && isLoProfile(person)) throw new HttpError(403, 'Silakan masuk ke Dashboard LO dan buka Absen Saya.');
  return person;
}

// Riwayat absensi yang pernah dikirim dari perangkat/browser ini (berdasarkan ID perangkat
// acak yang disimpan di browser). POST agar ID tidak tercatat di log URL.
r.post('/riwayat', ipLimiter, ah(async (req, res) => {
  const deviceId = String(req.body?.deviceId || '');
  if (!/^[\w-]{8,64}$/.test(deviceId)) throw new HttpError(400, 'ID perangkat tidak valid');
  const { rows } = await q(
    `SELECT a.created_at, a.status, a.distance_m,
            s.name AS session, s.type AS session_type,
            v.name AS venue, p.name, p.role
     FROM attendance a
     JOIN people p ON p.id = a.person_id
     JOIN sessions s ON s.id = a.session_id
     LEFT JOIN venues v ON v.id = a.venue_id
     WHERE a.device_id = $1
     ORDER BY a.created_at DESC
     LIMIT 100`,
    [deviceId]
  );
  res.json(rows.map((x) => ({ ...x, distance_m: Math.round(x.distance_m) })));
}));

// Cek posisi sebelum foto, supaya peserta tahu apakah sudah di dalam area venue.
// Keputusan akhir tetap di /attendance (pakai banyak sampel + deteksi fake GPS).
const precheck = ah(async (req, res) => {
  const { token, lat, lng, accuracy } = req.body || {};
  const ch = attendanceChallenge(req, token);
  if (![lat, lng].every((x) => typeof x === 'number' && Number.isFinite(x))) throw new HttpError(400, 'Lokasi tidak valid');
  const [person, { rows: [session] }] = await Promise.all([
    challengePerson(req, ch),
    q('SELECT * FROM sessions WHERE id=$1 AND (NOT is_test OR $2::boolean)', [ch.s, ch.lo != null]),
  ]);
  if (!person || !session) throw new HttpError(400, 'Data tidak ditemukan');
  const settings = await getSettings();
  const acc = typeof accuracy === 'number' && Number.isFinite(accuracy) ? accuracy : 0;
  const l = locate(lat, lng, acc, await allowedVenues(person, session), settings.max_accuracy_m);
  if (l.state === 'none') return res.json({ state: 'none', inside: false, venue: null });
  res.json({
    state: l.state,                       // ok | uncertain | outside | unknown
    inside: l.state === 'ok' || l.state === 'uncertain',
    review: l.state === 'uncertain' || !!l.lowAccuracy, // akan diverifikasi manual
    venue: l.venue?.name ?? null,
    distance_m: l.distance != null ? Math.round(l.distance) : null,
    radius_m: l.venue?.radius_m ?? null,
    max_accuracy_m: settings.max_accuracy_m,
  });
});
r.post('/precheck', precheck);
r.post('/lo/precheck', requireAdmin, requireLo, precheck);

// Langkah 2: kirim foto realtime + sampel GPS
const recordAttendance = ah(async (req, res) => {
  const { token, photo, samples: rawSamples, deviceId, clientTime, meta } = req.body || {};
  const ch = attendanceChallenge(req, token);

  const settings = await getSettings();
  const [person, { rows: [session] }] = await Promise.all([
    challengePerson(req, ch),
    q('SELECT * FROM sessions WHERE id=$1 AND (NOT is_test OR $2::boolean)', [ch.s, ch.lo != null]),
  ]);
  if (!person || !session) throw new HttpError(400, 'Data tidak ditemukan');
  if (Date.now() > new Date(session.ends_at).getTime() + 60_000) {
    throw new HttpError(400, 'Sesi absensi sudah ditutup.');
  }

  // Batas per orang (bukan per IP): cegah coba-coba lokasi berulang kali
  const [{ rows: [fails] }, { rows: [already] }] = await Promise.all([
    q(`SELECT count(*)::int AS n FROM attempt_logs
       WHERE person_id=$1 AND created_at > now() - interval '10 minutes'`, [person.id]),
    q('SELECT status FROM attendance WHERE person_id=$1 AND session_id=$2', [person.id, session.id]),
  ]);
  if (already && !(ch.lo != null && already.status === 'ditolak')) throw new HttpError(409, alreadyRecorded(already.status));
  if (fails.n >= MAX_FAILED_PER_PERSON) {
    throw new HttpError(429, 'Terlalu banyak percobaan gagal. Tunggu 10 menit atau hubungi panitia.');
  }

  // Validasi foto (harus JPEG dari kamera, ukuran wajar)
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(photo || ''));
  if (!m) throw new HttpError(400, 'Foto tidak valid. Ambil foto langsung dari kamera.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 4_000 || buf.length > 1_500_000 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new HttpError(400, 'Foto tidak valid. Ambil foto langsung dari kamera.');
  }

  const venues = await allowedVenues(person, session);
  const samples = sanitizeSamples(rawSamples);
  const loc = analyzeLocation(samples, venues, { maxAccuracy: settings.max_accuracy_m, clientTime });
  const hard = loc.hard;
  const ip = clientIp(req);
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  const dev = String(deviceId || '').slice(0, 64) || null;

  if (hard.length) {
    await q(
      `INSERT INTO attempt_logs (person_id, session_id, venue_id, reasons, lat, lng, accuracy_m, distance_m, device_id, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [person.id, session.id, loc.nearVenue?.id ?? null, JSON.stringify(hard), loc.lat ?? null, loc.lng ?? null,
        loc.accuracy ?? null, loc.distance ?? null, dev, ip, ua]
    );
    throw new HttpError(422, 'Absensi ditolak', { reasons: hard });
  }

  const flags = [...loc.flags, ...analyzeClientMeta(meta)];

  // Satu HP dipakai absen untuk orang lain di sesi yang sama (titip absen)
  if (dev) {
    const { rows } = await q(
      `SELECT p.name FROM attendance a JOIN people p ON p.id=a.person_id
       WHERE a.session_id=$1 AND a.device_id=$2 AND a.person_id<>$3 LIMIT 3`,
      [session.id, dev, person.id]
    );
    if (rows.length) {
      flags.push({ code: 'perangkat_dipakai_orang_lain', detail: `Perangkat sama dengan: ${rows.map((x) => x.name).join(', ')}` });
    }
  }

  // Teleport: lokasi absen sebelumnya mustahil dicapai dalam selang waktu tsb.
  const prev = await q(
    'SELECT lat, lng, created_at FROM attendance WHERE person_id=$1 AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY created_at DESC LIMIT 1', [person.id]);
  if (prev.rows[0]) {
    const p = prev.rows[0];
    const hours = (Date.now() - new Date(p.created_at).getTime()) / 3_600_000;
    const km = haversine(p.lat, p.lng, loc.lat, loc.lng) / 1000;
    if (km > 1 && hours > 0 && km / hours > 200) {
      flags.push({ code: 'teleport', detail: `Pindah ${km.toFixed(1)} km dalam ${(hours * 60).toFixed(0)} menit` });
    }
  }

  const score = scoreOf(flags);
  const status = score >= 2 ? 'review' : 'valid';

  const safeCode = person.code.replace(/[^\w-]+/g, '_');
  const file = await savePhoto(
    `sesi-${session.id}/venue-${loc.venue.id}/${person.role}-${safeCode}-${person.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.jpg`,
    buf
  );

  const ins = await q(
    `INSERT INTO attendance AS current_attendance (person_id, session_id, venue_id, photo_path, lat, lng, accuracy_m, distance_m, status,
       risk_score, flags, samples, device_id, ip, user_agent, client_time)
     SELECT $1,s.id,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16 FROM sessions s
     WHERE s.id=$2 AND (NOT s.is_test OR $17::boolean)
     ON CONFLICT (person_id, session_id) DO UPDATE SET
       photo_history=current_attendance.photo_history || jsonb_build_array(jsonb_build_object(
         'photo_path',current_attendance.photo_path,'at',current_attendance.created_at,
         'status',current_attendance.status,'venue_id',current_attendance.venue_id)),
       venue_id=EXCLUDED.venue_id,photo_path=EXCLUDED.photo_path,lat=EXCLUDED.lat,lng=EXCLUDED.lng,
       accuracy_m=EXCLUDED.accuracy_m,distance_m=EXCLUDED.distance_m,status=EXCLUDED.status,
       risk_score=EXCLUDED.risk_score,flags=EXCLUDED.flags,samples=EXCLUDED.samples,
       device_id=EXCLUDED.device_id,ip=EXCLUDED.ip,user_agent=EXCLUDED.user_agent,
       client_time=EXCLUDED.client_time,created_at=EXCLUDED.created_at,method='selfie',scanned_by=NULL
     WHERE current_attendance.status='ditolak' AND $17::boolean RETURNING id, created_at`,
    [person.id, session.id, loc.venue.id, file, loc.lat, loc.lng, loc.accuracy, loc.distance, status, score,
      JSON.stringify(flags), JSON.stringify(compactSamples(samples)), dev, ip, ua,
      clientTime && !isNaN(new Date(clientTime)) ? new Date(clientTime) : null, ch.lo != null]
  );
  if (!ins.rows[0]) {
    await deletePhoto(file);
    const { rows: [recorded] } = await q('SELECT status FROM attendance WHERE person_id=$1 AND session_id=$2', [person.id, session.id]);
    if (!recorded) throw new HttpError(400, 'Sesi ini sudah tidak tersedia untuk absensi resmi.');
    throw new HttpError(409, alreadyRecorded(recorded?.status));
  }

  res.json({
    status,
    at: ins.rows[0].created_at,
    distance_m: Math.round(loc.distance),
    venue: loc.venue.name,
    session: session.name,
    session_type: session.type,
    check_in_day: withReportingDay(session).check_in_day,
    name: person.name,
  });
});
r.post('/attendance', recordAttendance);
r.post('/lo/attendance', requireAdmin, requireLo, recordAttendance);

export default r;
