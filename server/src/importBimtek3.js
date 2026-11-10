import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
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

async function prepareFacilitators(db, facilitators, venueIds, dryRun) {
  await db.query('LOCK TABLE people IN SHARE ROW EXCLUSIVE MODE');
  const { rows: existing } = await db.query(
    "SELECT code, name, role, position, venue_id, archived_at FROM people WHERE lower(trim(position)) ~ '^fasil(itator)?($|[[:space:]])'");
  const newRows = [];
  const assignments = facilitators.map((row) => {
    const venueId = venueIds.get(row.venue);
    const matches = existing.filter((person) => norm(person.name) === norm(row.name));
    const [profile] = matches;
    if (!venueId || matches.length > 1 || (profile &&
      (profile.role !== 'peserta' || profile.venue_id !== venueId || profile.archived_at))) {
      throw new Error(`Profil fasilitator perlu diperiksa: ${row.name}.`);
    }
    const code = profile?.code || 'F-' + createHash('sha256').update(norm(row.name)).digest('hex').slice(0, 12).toUpperCase();
    const position = profile?.position || 'Fasilitator Pelaporan';
    if (!profile) newRows.push({ code, name: row.name, position, venue_id: venueId, institution: row.institution, ruangan: row.room });
    return { ...row, code, position };
  });
  if (!dryRun && newRows.length) {
    await db.query(`INSERT INTO people (code,name,role,position,venue_id,institution,ruangan,roster_added_at)
      SELECT code,name,'peserta',position,venue_id,institution,ruangan,now()
      FROM jsonb_to_recordset($1::jsonb) AS f(code text,name text,position text,venue_id int,institution text,ruangan text)`,
    [JSON.stringify(newRows)]);
  }
  return { assignments, createdFacilitators: newRows.length };
}

function attendanceAssignments(people, rosterLo) {
  const byAssignment = new Map(rosterLo.map((lo) => [JSON.stringify([lo.venue, lo.name]), lo]));
  const groups = {};
  for (const person of people) {
    const owner = byAssignment.get(JSON.stringify([person.venue, person.lo]));
    if (!owner) throw new Error('Ada peserta dengan penugasan LO yang belum terdaftar.');
    (groups[owner.account_id] ??= []).push({
      code: person.code, name: person.name, position: person.position, npsn: person.npsn ?? null, venue_id: owner.venue_id,
    });
  }
  return groups;
}

async function prepareOrganizations(db, organizations, venueIds, dryRun) {
  const rows = organizations.map((entry) => {
    const prefix = entry.position === 'Dinas Pendidikan' ? 'DINAS' : 'BPMP';
    const key = norm(entry.venue) + ':' + norm(entry.institution);
    return { ...entry, code: prefix + '-' + createHash('sha256').update(key).digest('hex').slice(0, 12).toUpperCase(),
      venue_id: venueIds.get(entry.venue) };
  });
  if (rows.some((row) => row.venue_id == null) || new Set(rows.map((row) => row.code)).size !== rows.length) {
    throw new Error('Venue atau kode absensi instansi tidak valid.');
  }
  const { rows: existing } = await db.query(
    'SELECT code, role, position, institution, venue_id, archived_at FROM people WHERE lower(code)=ANY($1::text[])',
    [rows.map((row) => row.code.toLowerCase())]);
  const byCode = new Map(existing.map((row) => [row.code.toLowerCase(), row]));
  const missing = rows.filter((row) => {
    const profile = byCode.get(row.code.toLowerCase());
    if (!profile) return true;
    if (profile.role !== 'peserta' || profile.position !== row.position || profile.institution !== row.institution
      || profile.venue_id !== row.venue_id || profile.archived_at) {
      throw new Error(`Profil instansi perlu diperiksa: ${row.institution}.`);
    }
    return false;
  });
  if (!dryRun && missing.length) {
    await db.query(`INSERT INTO people (code,name,role,position,venue_id,institution,kab_kota,provinsi,roster_added_at)
      SELECT code,institution,'peserta',position,venue_id,institution,kab_kota,provinsi,now()
      FROM jsonb_to_recordset($1::jsonb) AS o(code text,position text,venue_id int,institution text,kab_kota text,provinsi text)`,
    [JSON.stringify(missing)]);
  }
  return missing.length;
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

  const { assignments, createdFacilitators } = await prepareFacilitators(db, roster.facilitators, venueIds, dryRun);
  const createdOrganizations = await prepareOrganizations(db, roster.organizations, venueIds, dryRun);
  const result = { createdVenues, renamedVenues, movedAccounts, createdAccounts, resetAccounts, createdFacilitators, createdOrganizations };
  if (dryRun) return result;
  await db.query(
    'INSERT INTO assignment_roster (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data',
    [JSON.stringify({ ...roster, lo: rosterLo, attendance_assignments: attendanceAssignments([...roster.participants, ...assignments], rosterLo) })]);
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
      roster.organizations?.filter((row) => row.position === 'Dinas Pendidikan').length !== 287 ||
      roster.organizations?.filter((row) => row.position === 'BB/BPMP').length !== 31 ||
      roster.participants.some((person) => !roster.lo.some((lo) => lo.name === person.lo && lo.venue === person.venue)) ||
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
