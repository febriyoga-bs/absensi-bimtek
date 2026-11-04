// Buat akun dashboard LO untuk semua LO (Pendamping Panitia) di satu venue, dari data/lo-pendamping-panitia.csv.
//
//   npm --prefix server run seed-lo -- --password RAHASIA
//   npm --prefix server run seed-lo -- --password RAHASIA --venue "Grand Mercure Jakarta Harmoni"
//   tambahkan --reset untuk MENGGANTI password akun yang sudah ada
//
// Username = kode LO huruf kecil (mis. lo1-06). Password tidak disimpan di kode/repo: wajib lewat --password.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { q, pool } from './db.js';
import { hashPassword } from './auth.js';
import { parsePeople } from './peopleImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const venueName = arg('venue') || 'Grand Mercure Jakarta Harmoni';
const password = arg('password');
const reset = process.argv.includes('--reset');

if (!password || password.length < 8) {
  console.error('Isi password minimal 8 karakter:  npm run seed-lo -- --password RAHASIA');
  process.exit(1);
}

const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const csvPath = path.join(__dirname, '../../data/lo-pendamping-panitia.csv');
const { people } = parsePeople(fs.readFileSync(csvPath, 'utf8'));
const list = people.filter((p) => norm(p.venue) === norm(venueName));
if (!list.length) {
  console.error(`Tidak ada LO dengan venue "${venueName}" di ${path.basename(csvPath)}.`);
  process.exit(1);
}

const { rows: venues } = await q('SELECT id, name FROM venues');
const venue = venues.find((v) => norm(v.name) === norm(venueName));
if (!venue) {
  console.error(`Venue "${venueName}" belum ada di database. Jalankan "npm run seed-venues" dulu.`);
  await pool.end();
  process.exit(1);
}

let created = 0, updated = 0, skipped = 0;
console.log(`Venue: ${venue.name} — ${list.length} LO\n`);
for (const p of list) {
  const username = p.code.toLowerCase();
  const { rows: [ex] } = await q('SELECT id FROM lo_accounts WHERE lower(username)=lower($1)', [username]);
  if (ex && !reset) { skipped++; console.log(`= ${username.padEnd(8)} ${p.name} (sudah ada, dilewati)`); continue; }
  if (ex) {
    await q('UPDATE lo_accounts SET name=$1, venue_id=$2, password_hash=$3, active=TRUE WHERE id=$4',
      [p.name, venue.id, hashPassword(password), ex.id]);
    updated++; console.log(`✎ ${username.padEnd(8)} ${p.name} (password diganti)`);
  } else {
    await q('INSERT INTO lo_accounts (name, username, password_hash, venue_id, active) VALUES ($1,$2,$3,$4,TRUE)',
      [p.name, username, hashPassword(password), venue.id]);
    created++; console.log(`+ ${username.padEnd(8)} ${p.name}`);
  }
}
console.log(`\nSelesai: ${created} dibuat, ${updated} diperbarui, ${skipped} dilewati.`);
console.log('Login di /admin/login → tab "LO Venue" dengan username di atas.');
await pool.end();
