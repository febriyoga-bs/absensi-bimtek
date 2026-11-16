// Impor pemetaan BIMTEK Tahap 4. Akun LO Tahap 3 dicopy (username dan password
// hash tetap sama); hanya nama LO baru yang memperoleh kredensial awal baru.
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { rawPool } from './db.js';
import { searchPathSql } from './eventContext.js';
import { hashPassword } from './auth.js';

const venues = {
  'Atria Tangerang': ['Jl. Boulevard Raya Gading Serpong, Tangerang', -6.24436, 106.62786],
  'Claro Makassar': ['Jl. A.P. Pettarani No. 3, Makassar', -5.1618, 119.4427],
  'Four Point Makassar': ['Jalan Andi Djemma No. 130, Makassar', -5.1555, 119.4310],
  'Harris Gubeng Surabaya': ['Jl. Bangka 8-18, Surabaya', -7.272358, 112.7496],
  'Holiday Inn Jakarta': ['Jl. Gajah Mada No. 211, Jakarta Barat', -6.145327, 106.815361],
  'Lumire Jakarta': ['Jl. Senen Raya No. 135, Jakarta Pusat', -6.1776, 106.8426],
  'Mercure Batavia Jakarta': ['Jl. Kali Besar Barat No. 44-46, Jakarta Barat', -6.132382, 106.810051],
  'Windham Surabaya': ['Jl. Basuki Rachmat No. 67-73, Surabaya', -7.26761, 112.74175],
};
const norm = (value) => String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
const code = (prefix, value) => `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 12).toUpperCase()}`;
const args = parseArgs({ options: { input: { type: 'string' }, credentials: { type: 'string' }, 'dry-run': { type: 'boolean' } } }).values;
if (!args.input || (!args['dry-run'] && !args.credentials?.endsWith('.local'))) {
  throw new Error('Pemakaian: npm run import-bimtek4 -- --input data/bimtek4-pemetaan.local [--dry-run | --credentials data/kredensial-lo-baru-tahap4.local]');
}
const roster = JSON.parse(readFileSync(args.input, 'utf8'));
if (roster.stage !== 4 || roster.assignment_policy !== 'participant_sheet_wins' || roster.venues.length !== 8 || roster.lo.length !== 114) {
  throw new Error('Berkas pemetaan Tahap 4 tidak valid. Buat ulang dengan readBimtek4.py.');
}
for (const name of roster.venues) if (!venues[name]) throw new Error(`Venue belum dikonfigurasi: ${name}`);

const client = await rawPool.connect();
try {
  await client.query('BEGIN');
  const { rows: [event] } = await client.query('SELECT * FROM public.bimtek_events WHERE id=4');
  if (!event) throw new Error('Kegiatan Tahap 4 belum tersedia. Jalankan migrasi terlebih dahulu.');
  await client.query(searchPathSql(event));
  const { rows: existingVenues } = await client.query('SELECT id,name FROM venues');
  const venueIds = new Map();
  for (const name of roster.venues) {
    const found = existingVenues.find((row) => norm(row.name) === norm(name));
    if (found) venueIds.set(name, found.id);
    else {
      const [address, lat, lng] = venues[name];
      const { rows: [added] } = await client.query(
        'INSERT INTO venues (name,address,lat,lng,active) VALUES ($1,$2,$3,$4,FALSE) RETURNING id', [name, address, lat, lng]);
      venueIds.set(name, added.id);
    }
  }
  const { rows: oldAccounts } = await client.query('SELECT id,name,username,password_hash FROM public.lo_accounts WHERE active');
  const { rows: targetAccounts } = await client.query('SELECT id,name,username FROM lo_accounts');
  const usedUsernames = new Set(targetAccounts.map((row) => row.username.toLowerCase()));
  const credentials = [];
  const lo = [];
  for (const item of roster.lo) {
    const venueId = venueIds.get(item.venue);
    const current = targetAccounts.find((row) => norm(row.name) === norm(item.name));
    if (current) { lo.push({ ...item, account_id: current.id, venue_id: venueId }); continue; }
    const legacy = oldAccounts.filter((row) => norm(row.name) === norm(item.name));
    if (legacy.length > 1) throw new Error(`Akun lama ganda untuk LO: ${item.name}`);
    if (legacy[0]) {
      const row = legacy[0];
      const { rows: [added] } = await client.query('INSERT INTO lo_accounts (name,username,password_hash,venue_id) VALUES ($1,$2,$3,$4) RETURNING id', [item.name, row.username, row.password_hash, venueId]);
      usedUsernames.add(row.username.toLowerCase()); lo.push({ ...item, account_id: added.id, venue_id: venueId });
      continue;
    }
    const prefix = `LO${roster.venues.indexOf(item.venue) + 1}.${norm(item.name).slice(0, 18)}`;
    let username = prefix, suffix = 2;
    while (usedUsernames.has(username.toLowerCase())) username = `${prefix}.${suffix++}`;
    const password = randomBytes(14).toString('base64url');
    const { rows: [added] } = await client.query('INSERT INTO lo_accounts (name,username,password_hash,venue_id) VALUES ($1,$2,$3,$4) RETURNING id', [item.name, username, hashPassword(password), venueId]);
    usedUsernames.add(username.toLowerCase()); lo.push({ ...item, account_id: added.id, venue_id: venueId });
    credentials.push(`${username}\t${password}\t${item.name}\t${item.venue}`);
  }
  const facilitators = roster.facilitators.map((item) => ({ ...item, code: code('F', `${item.venue}:${norm(item.name)}`) }));
  const byOwner = new Map(lo.map((item) => [`${item.venue}\u0000${item.name}`, item]));
  const attendance_assignments = {};
  for (const item of [...roster.participants, ...facilitators]) {
    const owner = byOwner.get(`${item.venue}\u0000${item.lo}`);
    if (!owner) throw new Error(`LO tidak ditemukan untuk ${item.name}`);
    (attendance_assignments[owner.account_id] ||= []).push({ code: item.code, name: item.name, position: item.position || 'Fasilitator Pelaporan', npsn: item.npsn || null, venue_id: owner.venue_id });
  }
  await client.query('INSERT INTO assignment_roster (id,data) VALUES (1,$1) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data', [JSON.stringify({ ...roster, lo, facilitators, attendance_assignments })]);
  if (args['dry-run']) { await client.query('ROLLBACK'); console.log(`Simulasi siap: ${lo.length} akun LO, ${credentials.length} akun baru.`); }
  else {
    await client.query('COMMIT');
    if (credentials.length) writeFileSync(args.credentials, `Username\tPassword awal\tNama LO\tVenue\n${credentials.join('\n')}\n`, { flag: 'wx', mode: 0o600 });
    console.log(`Impor Tahap 4 selesai: ${lo.length} akun LO, ${credentials.length} akun baru.`);
  }
} catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
finally { client.release(); await rawPool.end(); }
