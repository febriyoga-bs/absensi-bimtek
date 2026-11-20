import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { rawPool, ensureStorageMode } from './db.js';
import { unifiedStorage } from './unifiedStorage.js';
import { hashPassword } from './auth.js';
import { ensureRosterLoProfiles } from './loProfile.js';
import { insertPksSchedule } from './pksSchedule.js';

const args = parseArgs({ options: { input: { type: 'string' }, credentials: { type: 'string' }, 'dry-run': { type: 'boolean' } } }).values;
if (!args.input || (!args['dry-run'] && (!args.credentials?.endsWith('.local') || existsSync(args.credentials)))) {
  throw new Error('Gunakan --input data/pks-pemetaan.local dan --dry-run atau --credentials <file-baru.local>');
}
const roster = JSON.parse(readFileSync(args.input, 'utf8'));
if (roster.kind !== 'pks_spab' || roster.schools.length !== 1433 || roster.lo.length !== 38 || roster.venues.length !== 3) throw new Error('Pemetaan PKS tidak valid.');
const code = value => createHash('sha256').update(value).digest('hex').slice(0, 16).toUpperCase();
await ensureStorageMode();
const event = { id: 5, schema_name: 'bimtek_5', name: 'BIMTEK PKS SPAB · 23–28 November 2026', status: 'draft' };
// Provision uses one transaction; never changes the active reporting event.
const raw = await rawPool.connect();
let db;
try {
  await raw.query('BEGIN');
  await raw.query('SELECT pg_advisory_xact_lock(78103421)');
  const { rows: existing } = await raw.query('SELECT id FROM public.bimtek_events WHERE id=5');
  if (existing.length) throw new Error('PKS sudah disiapkan. Gunakan menu admin untuk perubahan; impor ulang tidak diizinkan.');
  await raw.query('INSERT INTO public.bimtek_events(id,name,schema_name,status) VALUES(5,$1,$2,$3)', [event.name, event.schema_name, event.status]);
  if (!unifiedStorage()) {
    await raw.query('CREATE SCHEMA bimtek_5; SET LOCAL search_path TO bimtek_5, pg_catalog');
    await raw.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  }
  // Adapt queries using the same transaction and event isolation as runtime.
  const { searchPathSql } = await import('./eventContext.js');
  await raw.query(searchPathSql(event));
  // scopedConnection would start another transaction: use the SQL adapter directly.
  const { eventSql } = await import('./unifiedStorage.js');
  db = { query: (sql, params) => raw.query(eventSql(sql), params) };
  await db.query(`INSERT INTO settings(id,event_name,event_dates,venue_secret) VALUES(1,$1,'23–28 November 2026',md5(random()::text))
    ON CONFLICT(id) DO UPDATE SET event_name=EXCLUDED.event_name,event_dates=EXCLUDED.event_dates`, [event.name]);
  const venueIds = new Map();
  for (const name of roster.venues) {
    // Coordinates must be confirmed in Venue before GPS attendance is enabled.
    const { rows: [venue] } = await db.query('INSERT INTO venues(name,lat,lng,active) VALUES($1,0,0,false) RETURNING id', [name]);
    venueIds.set(name, venue.id);
  }
  const credentials = [];
  const lo = [];
  for (const [index, row] of roster.lo.entries()) {
    const username = `PKS.LO${String(index + 1).padStart(2, '0')}`;
    const password = randomBytes(18).toString('base64url');
    const venue_id = venueIds.get(row.venue);
    const { rows: [account] } = await db.query('INSERT INTO lo_accounts(name,username,password_hash,venue_id) VALUES($1,$2,$3,$4) RETURNING id', [row.name, username, hashPassword(password), venue_id]);
    lo.push({ ...row, venue_id, account_id: account.id });
    credentials.push(`${username}\t${password}\t${row.name}\t${row.venue}`);
  }
  const participants = roster.schools.flatMap(school => ['Kepala Sekolah', 'Bendahara'].map(position => ({
    ...school, position, code: `PKS-${position === 'Bendahara' ? 'B' : 'K'}-${school.npsn}`,
    name: `${position} — ${school.name}`, institution: school.name,
  })));
  const facilitators = roster.facilitators.map(row => ({ ...row, code: `PKS-V-${code(row.venue + ':' + row.name)}` }));
  const attendance_assignments = {};
  for (const row of [...participants, ...facilitators]) {
    const owner = lo.find(item => item.name === row.lo && item.venue === row.venue);
    if (!owner) throw new Error(`LO tidak ditemukan: ${row.lo}`);
    (attendance_assignments[owner.account_id] ||= []).push({ code: row.code, name: row.name, position: row.position || 'Verifikator', npsn: row.npsn || null, venue_id: owner.venue_id });
  }
  await db.query('INSERT INTO assignment_roster(id,data) VALUES(1,$1)', [JSON.stringify({ ...roster, lo, participants, facilitators, attendance_assignments })]);
  const profiles = [...participants, ...new Map(facilitators.map(row => [row.code, { ...row, position: 'Verifikator' }])).values()]
    .map(row => ({ ...row, venue_id: venueIds.get(row.venue) }));
  await db.query(`INSERT INTO people(code,name,role,position,venue_id,npsn,institution,provinsi,kab_kota,fasil_pelaporan,roster_added_at)
    SELECT code,name,'peserta',position,venue_id,npsn,institution,provinsi,kab_kota,facilitator,now()
    FROM jsonb_to_recordset($1::jsonb) x(code text,name text,position text,venue_id int,npsn text,institution text,provinsi text,kab_kota text,facilitator text)`, [JSON.stringify(profiles)]);
  await ensureRosterLoProfiles(db.query);
  await insertPksSchedule(db.query);
  // Return to owner role for private authentication metadata.
  await raw.query('RESET ROLE');
  await raw.query(`CREATE TABLE IF NOT EXISTS public.pks_admin_account(id int PRIMARY KEY CHECK(id=1),password_hash text NOT NULL);
    ALTER TABLE public.pks_admin_account ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.pks_admin_account FROM PUBLIC`);
  const password = randomBytes(18).toString('base64url');
  await raw.query('INSERT INTO public.pks_admin_account(id,password_hash) VALUES(1,$1)', [hashPassword(password)]);
  credentials.unshift(`admin.pks.spab\t${password}\tAdmin PKS Satdik Aman Bencana\tSemua venue PKS`);
  if (args['dry-run']) await raw.query('ROLLBACK');
  else {
    writeFileSync(args.credentials, `Username\tPassword awal\tNama\tVenue\n${credentials.join('\n')}\n`, { flag: 'wx', mode: 0o600 });
    await raw.query('COMMIT');
  }
  console.log(JSON.stringify({ dry_run: !!args['dry-run'], schools: participants.length / 2, lo: lo.length, verifiers: new Set(facilitators.map(row => row.code)).size, status: 'draft', venues_need_coordinates: true }));
} catch (error) { await raw.query('ROLLBACK').catch(() => {}); throw error; }
finally { raw.release(); await rawPool.end(); }
