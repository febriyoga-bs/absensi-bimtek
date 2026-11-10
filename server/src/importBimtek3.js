import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { hashPassword } from './auth.js';
import { pool } from './db.js';

// Nama mengikuti Excel. Titik awal berasal dari referensi hotel/peta.
// Venue baru dibuat nonaktif sampai panitia mengecek titik dan radius absensi.
// Urutan ini menentukan awalan username LO1 sampai LO7.
const hotels = {
  'Grand Mercure Jogja': ['Jl. Laksda Adisucipto No. 80, Sleman', -7.783458, 110.392004, 'Hotel Grand Mercure Yogya', 'Grand Mercure Yogyakarta Adi Sucipto'],
  'Atria Tangerang': ['Jl. Boulevard Raya Gading Serpong, Tangerang', -6.24436, 106.62786, 'Atria Hotel Gading Serpong'],
  'Holiday Inn': ['Jl. Gajah Mada No. 211, Glodok, Jakarta Barat', -6.145327, 106.815361, 'Holiday Inn & Suites Jakarta Gajah Mada'],
  'Mercure Jakarta Batavia': ['Jl. Kali Besar Barat No. 44–46, Jakarta Barat', -6.132382, 106.810051],
  'Sahid Jaya Jogja': ['Jl. Babarsari No. 2, Sleman', -7.78003, 110.41431, 'Sahid Raya Hotel & Convention Yogyakarta'],
  'Vasa Hotel Surabaya': ['Jl. HR Muhammad No. 31, Surabaya', -7.286, 112.6988, 'Vasa Surabaya'],
  'Wyndham Hotel Surabaya': ['Jl. Basuki Rachmat No. 67–73, Surabaya', -7.26761, 112.74175, 'Wyndham Surabaya'],
};

// Nama lama yang sudah dicocokkan dengan Rekap LO.
const accountAliases = {
  'adeafrilia': 'adeafrillia',
  'febriyogabagussatria': 'febriyogabaguss',
  'fikrinuriksanseptiadi': 'fikrinurikhsan',
  'hanifanoctozaalf': 'hanifanoctozaalfadli',
};

const norm = (s) => String(s).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');

const nameWords = (name) => name.trim().split(/\s+/).map(norm).filter(Boolean);

function usernameFor({ name, venue }, roster) {
  const words = nameWords(name);
  const sameFirstName = roster.filter((lo) => lo.venue === venue && nameWords(lo.name)[0] === words[0]);
  const displayName = words.slice(0, sameFirstName.length > 1 ? 2 : 1)
    .map((word) => word[0].toUpperCase() + word.slice(1)).join('.');
  return `LO${Object.keys(hotels).indexOf(venue) + 1}.${displayName}`;
}

async function importRoster(db, roster, { dryRun, credentialsPath, resetLogins, sharedPassword }) {
  await db.query('LOCK TABLE venues, lo_accounts IN SHARE ROW EXCLUSIVE MODE');
  const { rows: venues } = await db.query('SELECT id, name FROM venues');
  const { rows: accounts } = await db.query('SELECT id, name, username, venue_id FROM lo_accounts');
  const venueIds = new Map();
  let createdVenues = 0, renamedVenues = 0, movedAccounts = 0;
  for (const name of roster.venues) {
    if (!Object.hasOwn(hotels, name)) throw new Error(`Hotel belum dikonfigurasi: ${name}`);
    const [address, lat, lng, ...aliases] = hotels[name];
    const names = [name, ...aliases].map(norm);
    const matches = venues.filter((v) => names.includes(norm(v.name)));
    if (matches.length > 1) throw new Error(`Ada lebih dari satu venue yang cocok dengan ${name}.`);
    const [venue] = matches;
    if (venue) {
      if (venue.name !== name) {
        if (!dryRun) await db.query('UPDATE venues SET name=$1 WHERE id=$2', [name, venue.id]);
        renamedVenues++;
      }
      venueIds.set(name, venue.id);
    } else {
      createdVenues++;
      if (dryRun) {
        venueIds.set(name, -createdVenues);
        continue;
      }
      const { rows: [added] } = await db.query(
        'INSERT INTO venues (name, address, lat, lng, active) VALUES ($1,$2,$3,$4,FALSE) RETURNING id',
        [name, address, lat, lng]);
      venueIds.set(name, added.id);
    }
  }

  const credentials = [];
  const rosterLo = [];
  const claimed = new Map(accounts.map((a) => [a.username.toLowerCase(), a.id]));
  let createdAccounts = 0, resetAccounts = 0;
  for (const lo of roster.lo) {
    const { name, venue } = lo;
    const venueId = venueIds.get(venue);
    const key = norm(name);
    const matches = accounts.filter((a) => [key, accountAliases[key]].includes(norm(a.name)));
    if (!venueId || matches.length > 1) throw new Error(`Penempatan akun LO perlu diperiksa: ${name}.`);
    const [account] = matches;
    if (account) rosterLo.push({ ...lo, account_id: account.id, venue_id: venueId });
    if (account && account.venue_id !== venueId) {
      if (!dryRun) await db.query('UPDATE lo_accounts SET venue_id=$1 WHERE id=$2', [venueId, account.id]);
      movedAccounts++;
    }
    if (account && !resetLogins) continue;

    const username = usernameFor(lo, roster.lo);
    const lowerUsername = username.toLowerCase();
    if (!/^LO[1-7]\.[A-Za-z0-9][A-Za-z0-9.]*$/.test(username) || username.length > 32 ||
        (claimed.has(lowerUsername) && claimed.get(lowerUsername) !== account?.id)) {
      throw new Error(`Username perlu diperiksa: ${username}.`);
    }
    claimed.set(lowerUsername, account?.id ?? null);

    if (account) {
      resetAccounts++;
      if (!dryRun) {
        await db.query('UPDATE lo_accounts SET username=$1, password_hash=$2 WHERE id=$3',
          [username, hashPassword(sharedPassword), account.id]);
        credentials.push([username, name, venue].join('\t'));
      }
      continue;
    }
    createdAccounts++;
    if (dryRun) continue;
    const password = resetLogins ? sharedPassword : randomBytes(18).toString('base64url');
    const { rows: [added] } = await db.query(
      'INSERT INTO lo_accounts (name, username, password_hash, venue_id) VALUES ($1,$2,$3,$4) RETURNING id',
      [name, username, hashPassword(password), venueId]);
    rosterLo.push({ ...lo, account_id: added.id, venue_id: venueId });
    credentials.push((resetLogins ? [username, name, venue] : [username, password, name, venue]).join('\t'));
  }

  const result = { createdVenues, renamedVenues, movedAccounts, createdAccounts, resetAccounts };
  if (dryRun) return result;
  await db.query(
    'INSERT INTO assignment_roster (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data',
    [JSON.stringify({ ...roster, lo: rosterLo })]);
  if (credentials.length) {
    const header = resetLogins ? 'Username\tNama LO\tVenue' : 'Username\tPassword awal\tNama LO\tVenue';
    writeFileSync(credentialsPath, [header, ...credentials].join('\n') + '\n',
      { flag: 'wx', mode: 0o600 });
  }
  return result;
}

const { values } = parseArgs({
  options: {
    input: { type: 'string' }, credentials: { type: 'string' },
    'dry-run': { type: 'boolean' }, 'reset-lo-logins': { type: 'boolean' },
  },
});
const dryRun = values['dry-run'];
const resetLogins = values['reset-lo-logins'];
const sharedPassword = process.env.BIMTEK_LO_PASSWORD || '';
if (!values.input || (!dryRun && !values.credentials?.endsWith('.local'))) {
  console.error('Pemakaian: npm run import-bimtek3 -- --input PEMETAAN.local [--dry-run | --credentials KREDENSIAL.local]');
  process.exit(1);
}
if (resetLogins && !dryRun && (sharedPassword.length < 8 || sharedPassword.length > 72)) {
  console.error('Isi BIMTEK_LO_PASSWORD dengan 8–72 karakter untuk mereset login LO.');
  process.exit(1);
}

try {
  const roster = JSON.parse(readFileSync(values.input, 'utf8'));
  if (roster.venues.length !== 7 || roster.lo.length !== 76 ||
      roster.facilitators.length !== 470 || roster.schools.length !== 1884 || roster.participants?.length !== 3360 ||
      roster.coordinators?.length !== 107 || roster.supervisors?.length !== 1476 ||
      new Set(roster.lo.map(({ name }) => norm(name))).size !== roster.lo.length) {
    throw new Error('Jumlah atau identitas data tidak cocok dengan pemetaan revisi 8.');
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await importRoster(db, roster, {
      dryRun, credentialsPath: values.credentials, resetLogins, sharedPassword,
    });
    await db.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    console.log(dryRun ? 'Simulasi selesai.' : 'Impor selesai.', result);
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    db.release();
  }
} catch (e) {
  console.error(`Impor gagal: ${e.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
