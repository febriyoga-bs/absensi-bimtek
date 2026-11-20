import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { rawPool, pool, ensureStorageMode } from './db.js';
import { eventContext } from './eventContext.js';
import { planPksMappingUpdate, applyPksMappingPlan } from './pksMappingUpdate.js';
import { invalidateReportingRoster } from './reporting.js';

const args = parseArgs({ options: { input: { type: 'string' }, 'dry-run': { type: 'boolean' } } }).values;
if (!args.input) throw new Error('Gunakan --input <pemetaan.local> [--dry-run]');
const source = JSON.parse(readFileSync(args.input, 'utf8'));
await ensureStorageMode();
const { rows: [event] } = await rawPool.query('SELECT * FROM public.bimtek_events WHERE id=5');
if (!event) throw new Error('Kegiatan PKS tidak tersedia.');
const db = await eventContext.run(event, () => pool.connect());
try {
  await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(78103421)');
  await db.query('LOCK TABLE people, assignment_roster IN SHARE ROW EXCLUSIVE MODE');
  await db.query('LOCK TABLE lo_accounts,venues,sessions,settings,attendance,attempt_logs IN SHARE MODE');
  const before = { event };
  for (const table of ['assignment_roster', 'people', 'lo_accounts', 'venues', 'sessions', 'settings', 'attendance', 'attempt_logs']) before[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  const plan = planPksMappingUpdate(source, { roster: before.assignment_roster[0]?.data, people: before.people, accounts: before.lo_accounts, venues: before.venues });
  mkdirSync(new URL('../../data/backups/', import.meta.url), { recursive: true });
  const backup = new URL(`../../data/backups/pks-mapping-${Date.now()}.local`, import.meta.url);
  writeFileSync(backup, JSON.stringify(before), { mode: 0o600, flag: 'wx' });
  await applyPksMappingPlan(db.query.bind(db), plan);
  for (const table of ['lo_accounts', 'venues', 'sessions', 'settings', 'attendance', 'attempt_logs']) {
    const { rows } = await db.query(`SELECT * FROM ${table} ORDER BY id`);
    if (JSON.stringify(rows) !== JSON.stringify(before[table])) throw new Error(`Data di luar pemetaan ikut berubah: ${table}`);
  }
  const { rows: people } = await db.query('SELECT * FROM people ORDER BY id');
  const byId = new Map(people.map(row => [row.id,row]));
  for (const old of before.people) {
    const row = byId.get(old.id);
    if (!row || ['code','qr_token','role','position','created_at'].some(key => JSON.stringify(row[key]) !== JSON.stringify(old[key]))) throw new Error(`Identitas profil berubah: ${old.id}`);
    if (old.position === 'LO' && JSON.stringify(row) !== JSON.stringify(old)) throw new Error('Profil LO berubah.');
  }
  const { rows: [roster] } = await db.query('SELECT data FROM assignment_roster WHERE id=1');
  if (JSON.stringify(roster.data.pks_records) !== JSON.stringify(before.assignment_roster[0].data.pks_records || {})) throw new Error('Status PKS berubah.');
  const verifierCodes = new Set(roster.data.facilitators.map(row=>row.code));
  if (people.filter(row=>verifierCodes.has(row.code) && !row.archived_at).length !== plan.summary.verifiers) throw new Error('Profil verifikator belum lengkap.');
  await db.query(args['dry-run'] ? 'ROLLBACK' : 'COMMIT');
  invalidateReportingRoster();
  const result = { dry_run: !!args['dry-run'], event: 5, ...plan.summary, people: people.length,
    preserved: ['akun dan password LO','profil dan QR lama','jadwal','venue','absensi','status PKS'] };
  writeFileSync(new URL('../../data/pks-update-result.local', import.meta.url), JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} catch (error) { await db.query('ROLLBACK').catch(()=>{}); throw error; }
finally { db.release(); await rawPool.end(); }
