import 'dotenv/config';
import { rawPool, pool, ensureStorageMode } from './db.js';
import { eventContext } from './eventContext.js';
import { insertPksSchedule, pksSessions } from './pksSchedule.js';

await ensureStorageMode();
const { rows: [event] } = await rawPool.query('SELECT * FROM public.bimtek_events WHERE id=5');
if (!event) throw new Error('Kegiatan PKS belum tersedia.');
const db = await eventContext.run(event, () => pool.connect());
try {
  await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(78103421)');
  await db.query('LOCK TABLE sessions IN SHARE ROW EXCLUSIVE MODE');
  await db.query('LOCK TABLE attendance, attempt_logs IN SHARE MODE');
  const { rows: sessions } = await db.query('SELECT id,name,role,starts_at,ends_at,is_test FROM sessions ORDER BY starts_at,id');
  const old = sessions.filter(session => /^Absensi PKS Hari-[1-6]$/.test(session.name) && !session.is_test);
  if (old.length !== 6) throw new Error('Enam sesi sementara tidak ditemukan. Periksa jadwal sebelum mengubahnya.');
  const ids = old.map(session => session.id);
  const { rows: [recorded] } = await db.query(`SELECT
    (SELECT count(*)::int FROM attendance WHERE session_id=ANY($1::int[])) AS attendance,
    (SELECT count(*)::int FROM attempt_logs WHERE session_id=ANY($1::int[])) AS attempts`, [ids]);
  if (recorded.attendance || recorded.attempts) throw new Error('Sesi sementara sudah memiliki riwayat; perubahan dihentikan untuk menjaga catatan.');
  const officialOthers = sessions.filter(session => !ids.includes(session.id) && !session.is_test);
  if (officialOthers.length) throw new Error('Ada sesi resmi lain. Periksa konflik jadwal sebelum melanjutkan.');
  // Only unrecorded seed sessions are replaced. No person or attendance is removed.
  await db.query('DELETE FROM sessions WHERE id=ANY($1::int[])', [ids]);
  await db.query('UPDATE settings SET one_official_session_per_day=false WHERE id=1');
  await insertPksSchedule(db.query.bind(db));
  const dryRun = process.argv.includes('--dry-run');
  await db.query(dryRun ? 'ROLLBACK' : 'COMMIT');
  console.log(JSON.stringify({ dry_run: dryRun, event: 5, replaced: old.length, sessions: pksSessions }));
} catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }
finally { db.release(); await rawPool.end(); }
