import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { savePhoto, deletePhoto } from '../storage.js';
import { q, getSettings } from '../db.js';
import { ah, HttpError, haversine, verifyVenueCode, clientIp } from '../util.js';
import { signChallenge, verifyChallenge } from '../auth.js';
import { sanitizeSamples, analyzeLocation, analyzeClientMeta, scoreOf, locate } from '../antifake.js';

const r = Router();
const ROLES = ['peserta', 'panitia'];

// Ratusan peserta memakai WiFi venue yang sama = satu IP publik (NAT),
// jadi batas per-IP dibuat longgar (hanya menahan bot/brute force kasar).
// Batas yang sebenarnya dihitung per orang di database (lihat /attendance).
// Catatan: di Vercel penghitung ini per-instance (best effort).
const ipLimiter = rateLimit({ windowMs: 60_000, limit: Number(process.env.IP_RATE_LIMIT || 2000),
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Server sedang sangat sibuk, coba lagi dalam 1 menit.' } });
const MAX_FAILED_PER_PERSON = 10; // percobaan ditolak per orang per 10 menit

async function activeSession(role) {
  const { rows } = await q(
    `SELECT * FROM sessions
     WHERE role IN ($1,'semua') AND now() BETWEEN starts_at AND ends_at
     ORDER BY starts_at LIMIT 1`,
    [role]
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

const publicSession = (s) => s && ({ name: s.name, type: s.type, role: s.role, starts_at: s.starts_at, ends_at: s.ends_at });

r.get('/info', ah(async (req, res) => {
  const s = await getSettings();
  const [{ rows: venues }, { rows: sessions }] = await Promise.all([
    q('SELECT id, name, address, radius_m FROM venues WHERE active ORDER BY name'),
    // sesi yang sedang dibuka + sesi berikutnya hari ini/besok (untuk ditampilkan di beranda)
    q(`SELECT * FROM sessions WHERE ends_at > now() AND starts_at < now() + interval '36 hours'
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
    event_name: s.event_name,
    organizer: s.organizer,
    event_dates: s.event_dates,
    require_venue_code: s.require_venue_code,
    venues: venues.map(({ id, ...v }) => v),
    sessions: { peserta: forRole('peserta'), panitia: forRole('panitia') },
    server_time: new Date().toISOString(),
  });
}));

// Langkah 1: verifikasi kode peserta/panitia → token absen berlaku singkat
r.post('/challenge', ipLimiter, ah(async (req, res) => {
  const { code, role } = req.body || {};
  if (!ROLES.includes(role)) throw new HttpError(400, 'Peran tidak valid');
  const settings = await getSettings();

  const { rows } = await q('SELECT * FROM people WHERE lower(code) = lower($1)', [String(code || '').trim()]);
  const person = rows[0];
  if (!person) throw new HttpError(404, 'Kode tidak terdaftar. Periksa kembali atau hubungi panitia.');
  if (person.role !== role) {
    throw new HttpError(400, `Kode ini terdaftar sebagai ${person.role}. Gunakan halaman absen ${person.role}.`);
  }

  const session = await activeSession(role);
  if (!session) throw new HttpError(400, 'Belum ada sesi absensi yang dibuka saat ini.');

  const venues = await allowedVenues(person, session);
  if (!venues.length) throw new HttpError(400, 'Belum ada venue untuk Anda di sesi ini. Hubungi panitia.');

  const done = await q('SELECT created_at, status FROM attendance WHERE person_id=$1 AND session_id=$2',
    [person.id, session.id]);
  if (done.rows[0]) {
    throw new HttpError(409, 'Anda sudah absen untuk sesi ini.', { at: done.rows[0].created_at, status: done.rows[0].status });
  }

  const nonce = crypto.randomInt(0, 10000).toString().padStart(4, '0');
  res.json({
    token: signChallenge(person.id, session.id, nonce),
    nonce,
    person: { name: person.name, institution: person.institution, position: person.position, code: person.code },
    session: publicSession(session),
    venues: venues.map((v) => ({ name: v.name, address: v.address, radius_m: v.radius_m })),
    require_venue_code: settings.require_venue_code,
  });
}));

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
r.post('/precheck', ah(async (req, res) => {
  const { token, lat, lng, accuracy } = req.body || {};
  const ch = verifyChallenge(token);
  if (!ch) throw new HttpError(401, 'Waktu absen habis. Silakan ulangi dari awal.');
  if (![lat, lng].every((x) => typeof x === 'number' && Number.isFinite(x))) throw new HttpError(400, 'Lokasi tidak valid');
  const [{ rows: [person] }, { rows: [session] }] = await Promise.all([
    q('SELECT * FROM people WHERE id=$1', [ch.p]),
    q('SELECT * FROM sessions WHERE id=$1', [ch.s]),
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
}));

// Langkah 2: kirim foto realtime + sampel GPS
r.post('/attendance', ah(async (req, res) => {
  const { token, photo, samples: rawSamples, deviceId, venueCode, clientTime, meta } = req.body || {};
  const ch = verifyChallenge(token);
  if (!ch) throw new HttpError(401, 'Waktu absen habis. Silakan ulangi dari awal.');

  const settings = await getSettings();
  const [{ rows: [person] }, { rows: [session] }] = await Promise.all([
    q('SELECT * FROM people WHERE id=$1', [ch.p]),
    q('SELECT * FROM sessions WHERE id=$1', [ch.s]),
  ]);
  if (!person || !session) throw new HttpError(400, 'Data tidak ditemukan');
  if (Date.now() > new Date(session.ends_at).getTime() + 60_000) {
    throw new HttpError(400, 'Sesi absensi sudah ditutup.');
  }

  // Batas per orang (bukan per IP): cegah coba-coba lokasi berulang kali
  const [{ rows: [fails] }, { rows: [already] }] = await Promise.all([
    q(`SELECT count(*)::int AS n FROM attempt_logs
       WHERE person_id=$1 AND created_at > now() - interval '10 minutes'`, [person.id]),
    q('SELECT 1 FROM attendance WHERE person_id=$1 AND session_id=$2', [person.id, session.id]),
  ]);
  if (already) throw new HttpError(409, 'Anda sudah absen untuk sesi ini.');
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
  const hard = [...loc.hard];
  // Kode venue dicek terhadap venue tempat orang itu berada (tiap venue punya layar kode sendiri)
  if (settings.require_venue_code && loc.venue && !verifyVenueCode(loc.venue.code_secret, venueCode)) {
    hard.push(`Kode venue salah atau sudah kedaluwarsa. Lihat kode terbaru di layar panitia ${loc.venue.name}.`);
  }

  const ip = clientIp(req);
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  const dev = String(deviceId || '').slice(0, 64) || null;

  if (hard.length) {
    await q(
      `INSERT INTO attempt_logs (person_id, session_id, venue_id, reasons, lat, lng, accuracy_m, distance_m, device_id, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [person.id, session.id, loc.venue?.id ?? null, JSON.stringify(hard), loc.lat ?? null, loc.lng ?? null,
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
    'SELECT lat, lng, created_at FROM attendance WHERE person_id=$1 ORDER BY created_at DESC LIMIT 1', [person.id]);
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
    `INSERT INTO attendance (person_id, session_id, venue_id, photo_path, lat, lng, accuracy_m, distance_m, status,
       risk_score, flags, samples, device_id, ip, user_agent, client_time)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (person_id, session_id) DO NOTHING RETURNING id, created_at`,
    [person.id, session.id, loc.venue.id, file, loc.lat, loc.lng, loc.accuracy, loc.distance, status, score,
      JSON.stringify(flags), JSON.stringify(samples), dev, ip, ua,
      clientTime && !isNaN(new Date(clientTime)) ? new Date(clientTime) : null]
  );
  if (!ins.rows[0]) {
    await deletePhoto(file);
    throw new HttpError(409, 'Anda sudah absen untuk sesi ini.');
  }

  res.json({
    status,
    at: ins.rows[0].created_at,
    distance_m: Math.round(loc.distance),
    venue: loc.venue.name,
    session: session.name,
    session_type: session.type,
    name: person.name,
  });
}));

export default r;
