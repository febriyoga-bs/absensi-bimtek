import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import fs from 'fs';
import { q, getSettings } from '../db.js';
import { ah, HttpError, venueCode } from '../util.js';
import { requireAdmin, signAdmin, checkAdminPassword } from '../auth.js';
import { photoUrl } from '../storage.js';

const r = Router();

r.post('/login', rateLimit({ windowMs: 15 * 60_000, limit: 10 }), (req, res) => {
  if (!checkAdminPassword(req.body?.password)) return res.status(401).json({ error: 'Password salah' });
  res.json({ token: signAdmin() });
});

r.use(requireAdmin);

/* ---------- Pengaturan acara ---------- */
const publicSettings = ({ venue_secret, venue_name, venue_lat, venue_lng, radius_m, ...s }) => s;

r.get('/settings', ah(async (req, res) => res.json(publicSettings(await getSettings()))));

r.put('/settings', ah(async (req, res) => {
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
  const { rows } = await q(
    `SELECT v.*, (SELECT count(*) FROM people p WHERE p.venue_id=v.id)::int AS people_count
     FROM venues v ORDER BY v.active DESC, v.name`);
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

r.post('/venues', ah(async (req, res) => {
  const v = cleanVenue(req.body || {});
  const { rows } = await q(
    'INSERT INTO venues (name, address, lat, lng, radius_m, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [v.name, v.address, v.lat, v.lng, v.radius_m, v.active]);
  res.json(publicVenue(rows[0]));
}));

r.put('/venues/:id', ah(async (req, res) => {
  const v = cleanVenue(req.body || {});
  const { rows } = await q(
    'UPDATE venues SET name=$1, address=$2, lat=$3, lng=$4, radius_m=$5, active=$6 WHERE id=$7 RETURNING *',
    [v.name, v.address, v.lat, v.lng, v.radius_m, v.active, req.params.id]);
  if (req.body?.rotate_secret) {
    await q('UPDATE venues SET code_secret=$1 WHERE id=$2', [crypto.randomBytes(20).toString('hex'), req.params.id]);
  }
  res.json(rows[0] && publicVenue(rows[0]));
}));

r.delete('/venues/:id', ah(async (req, res) => {
  const { rows: [used] } = await q('SELECT count(*)::int AS n FROM attendance WHERE venue_id=$1', [req.params.id]);
  if (used.n > 0) {
    throw new HttpError(400, `Venue sudah dipakai ${used.n} absensi. Nonaktifkan saja agar riwayatnya tetap tersimpan.`);
  }
  await q('UPDATE sessions SET venue_ids = array_remove(venue_ids, $1::int)', [req.params.id]);
  await q('DELETE FROM venues WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

/** Kode venue berputar untuk layar di tiap venue */
r.get('/venues/:id/code', ah(async (req, res) => {
  const { rows: [v] } = await q('SELECT id, name, address, code_secret FROM venues WHERE id=$1', [req.params.id]);
  if (!v) throw new HttpError(404, 'Venue tidak ditemukan');
  const step = 30;
  const now = Date.now();
  res.json({
    venue: { id: v.id, name: v.name, address: v.address },
    code: venueCode(v.code_secret, 0, step, now),
    expires_in: step - (Math.floor(now / 1000) % step),
  });
}));

/* ---------- Peserta & Panitia ---------- */
r.get('/people', ah(async (req, res) => {
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

r.post('/people', ah(async (req, res) => {
  const { rows } = await upsertPerson(cleanPerson(req.body || {}));
  res.json(rows[0]);
}));

r.put('/people/:id', ah(async (req, res) => {
  const p = cleanPerson(req.body || {});
  const { rows } = await q(
    `UPDATE people SET code=$1, name=$2, role=$3, institution=$4, position=$5, phone=$6, venue_id=$7 WHERE id=$8 RETURNING *`,
    [p.code, p.name, p.role, p.institution, p.position, p.phone, p.venue_id, req.params.id]
  );
  res.json(rows[0]);
}));

r.delete('/people/:id', ah(async (req, res) => {
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

r.post('/people/import', ah(async (req, res) => {
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
r.get('/sessions', ah(async (req, res) => {
  const { rows } = await q(
    `SELECT s.*,
       (SELECT count(*) FROM people p WHERE (s.role='semua' OR p.role=s.role)
          AND (cardinality(COALESCE(s.venue_ids,'{}'))=0 OR p.venue_id IS NULL OR p.venue_id = ANY(s.venue_ids)))::int AS expected,
       (SELECT count(*) FROM attendance a WHERE a.session_id=s.id AND a.status='valid')::int AS valid,
       (SELECT count(*) FROM attendance a WHERE a.session_id=s.id AND a.status='review')::int AS review,
       (SELECT count(*) FROM attendance a WHERE a.session_id=s.id AND a.status='ditolak')::int AS rejected,
       (SELECT count(*) FROM attempt_logs l WHERE l.session_id=s.id)::int AS blocked,
       (SELECT COALESCE(json_agg(x ORDER BY x.name), '[]') FROM (
          SELECT v.name, count(*)::int AS n FROM attendance a JOIN venues v ON v.id=a.venue_id
          WHERE a.session_id=s.id AND a.status<>'ditolak' GROUP BY v.name) x) AS by_venue,
       now() BETWEEN s.starts_at AND s.ends_at AS is_open
     FROM sessions s ORDER BY starts_at`
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

r.post('/sessions', ah(async (req, res) => {
  const s = cleanSession(req.body || {});
  const { rows } = await q(
    'INSERT INTO sessions (name, role, type, starts_at, ends_at, venue_ids) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [s.name, s.role, s.type, s.starts_at, s.ends_at, s.venue_ids]);
  res.json(rows[0]);
}));

r.put('/sessions/:id', ah(async (req, res) => {
  const s = cleanSession(req.body || {});
  const { rows } = await q(
    'UPDATE sessions SET name=$1, role=$2, type=$3, starts_at=$4, ends_at=$5, venue_ids=$6 WHERE id=$7 RETURNING *',
    [s.name, s.role, s.type, s.starts_at, s.ends_at, s.venue_ids, req.params.id]);
  res.json(rows[0]);
}));

r.delete('/sessions/:id', ah(async (req, res) => {
  await q('DELETE FROM sessions WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

/* ---------- Absensi ---------- */
r.get('/attendance', ah(async (req, res) => {
  const venueId = req.query.venue_id ? Number(req.query.venue_id) : null;
  const { rows } = await q(
    `SELECT a.id, a.status, a.risk_score, a.flags, a.lat, a.lng, a.accuracy_m, a.distance_m,
            a.created_at, a.device_id, a.user_agent, a.ip, a.photo_path, a.venue_id,
            p.name, p.code, p.role, p.institution, p.position, v.name AS venue_name
     FROM attendance a JOIN people p ON p.id=a.person_id LEFT JOIN venues v ON v.id=a.venue_id
     WHERE a.session_id=$1 AND ($2::text IS NULL OR a.status=$2) AND ($3::int IS NULL OR a.venue_id=$3)
     ORDER BY a.risk_score DESC, a.created_at DESC`,
    [req.query.session_id, req.query.status || null, venueId]
  );
  // Signed URL R2 langsung di daftar → browser mengambil foto dari Cloudflare,
  // bukan lewat Vercel Function (hemat invocation & bandwidth).
  const out = await Promise.all(rows.map(async ({ photo_path, ...r }) => ({ ...r, photo_url: await photoUrl(photo_path) })));
  res.json(out);
}));

r.patch('/attendance/:id', ah(async (req, res) => {
  if (!['valid', 'review', 'ditolak'].includes(req.body?.status)) throw new HttpError(400, 'Status tidak valid');
  const { rows } = await q('UPDATE attendance SET status=$1 WHERE id=$2 RETURNING id, status', [req.body.status, req.params.id]);
  res.json(rows[0]);
}));

r.get('/attempts', ah(async (req, res) => {
  const { rows } = await q(
    `SELECT l.*, p.name, p.code, p.role, v.name AS venue_name
     FROM attempt_logs l LEFT JOIN people p ON p.id=l.person_id LEFT JOIN venues v ON v.id=l.venue_id
     WHERE l.session_id=$1 ORDER BY l.created_at DESC LIMIT 500`, [req.query.session_id]);
  res.json(rows);
}));

r.get('/photo/:id', ah(async (req, res) => {
  const { rows } = await q('SELECT photo_path FROM attendance WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).end();
  const url = await photoUrl(rows[0].photo_path, 600);
  if (url) return res.redirect(302, url);
  if (!fs.existsSync(rows[0].photo_path)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(rows[0].photo_path);
}));

/** Rekap CSV: semua orang yang wajib hadir di sesi + status kehadirannya. */
r.get('/export', ah(async (req, res) => {
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
     ORDER BY p.role, p.name`,
    [s.id, s.role, s.venue_ids]
  );
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const fmt = (d) => d ? new Date(d).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '';
  const header = ['Kode', 'Nama', 'Peran', 'Instansi', 'Jabatan', 'Venue Ditetapkan', 'Kehadiran', 'Status Verifikasi',
    'Waktu (WIB)', 'Venue Absen', 'Latitude', 'Longitude', 'Jarak (m)', 'Akurasi (m)', 'Catatan'];
  const lines = rows.map((r) => [
    r.code, r.name, r.role, r.institution, r.position, r.assigned_venue || 'Semua',
    r.status && r.status !== 'ditolak' ? 'Hadir' : 'Tidak hadir', r.status || '',
    fmt(r.created_at), r.venue || '', r.lat ?? '', r.lng ?? '',
    r.distance_m != null ? Math.round(r.distance_m) : '', r.accuracy_m != null ? Math.round(r.accuracy_m) : '',
    (r.flags || []).map((f) => f.detail).join('; '),
  ].map(esc).join(','));
  const name = `absensi-${s.name.replace(/[^\w-]+/g, '_')}.csv`;
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${name}"`);
  res.send('﻿' + [header.map(esc).join(','), ...lines].join('\r\n'));
}));

export default r;
