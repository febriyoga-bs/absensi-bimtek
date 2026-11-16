import { Router } from 'express';
import { rawPool, q } from './db.js';
import { currentEvent, eventContext, eventId, legacyReportingDays, searchPathSql } from './eventContext.js';
import { requireAdmin, requireSuper } from './auth.js';
import { ah, HttpError } from './util.js';

const publicEvent = ({ id, name, status }) => ({ id, name, status });
export const eventRoutes = Router();
eventRoutes.get('/', ah(async (_req, res) => {
  const { rows } = await rawPool.query('SELECT id,name,status FROM public.bimtek_events ORDER BY id');
  res.set('Cache-Control', 'no-store').json(rows);
}));

eventRoutes.get('/resolve-qr/:token', ah(async (req, res) => {
  if (!/^[a-f0-9]{32}$/.test(req.params.token)) throw new HttpError(404, 'Kartu tidak ditemukan.');
  const { rows } = await rawPool.query('SELECT * FROM public.bimtek_events ORDER BY id');
  for (const event of rows) {
    const match = await eventContext.run(event, () => q('SELECT 1 FROM people WHERE qr_token=$1 AND archived_at IS NULL', [req.params.token]));
    if (match.rowCount) return res.json(publicEvent(event));
  }
  throw new HttpError(404, 'Kartu tidak ditemukan.');
}));

// Only the main administrator may activate/archive an event.
eventRoutes.put('/:id/status', requireAdmin, requireSuper, ah(async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body?.status;
  if (!Number.isSafeInteger(id) || !['active','archived','draft'].includes(status)) throw new HttpError(400, 'Status kegiatan tidak valid.');
  const client = await rawPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE public.bimtek_events IN EXCLUSIVE MODE');
    const { rows: [event] } = await client.query('SELECT * FROM public.bimtek_events WHERE id=$1', [id]);
    if (!event) throw new HttpError(404, 'Kegiatan tidak ditemukan.');
    if (event.status === 'active' && status !== 'active') throw new HttpError(400, 'Aktifkan kegiatan pengganti untuk mengarsipkan kegiatan aktif.');
    if (status === 'active') await client.query("UPDATE public.bimtek_events SET status='archived' WHERE status='active' AND id<>$1", [id]);
    await client.query('UPDATE public.bimtek_events SET status=$1 WHERE id=$2', [status, id]);
    await client.query('COMMIT');
    res.json({ ...publicEvent(event), status });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}));

export const selectEvent = ah(async (req, res, next) => {
  const requested = req.query.event ?? req.headers['x-bimtek-event'];
  if (requested != null && (typeof requested !== 'string' || !/^[1-9]\d{0,8}$/.test(requested))) throw new HttpError(400, 'Kegiatan tidak valid.');
  const { rows: [event] } = await rawPool.query(requested == null
    ? "SELECT * FROM public.bimtek_events WHERE status='active'"
    : 'SELECT * FROM public.bimtek_events WHERE id=$1', requested == null ? [] : [Number(requested)]);
  if (!event) throw new HttpError(404, 'Kegiatan tidak ditemukan.');
  const safePost = ['/admin/login', '/riwayat', '/npsn'];
  if (event.status === 'archived' && !['GET','HEAD','OPTIONS'].includes(req.method) && !safePost.includes(req.path)) {
    throw new HttpError(409, 'Kegiatan ini sudah diarsipkan. Data hanya dapat dilihat dan diunduh.');
  }
  res.vary('X-Bimtek-Event');
  res.set('X-Bimtek-Event', String(event.id));
  await eventContext.run(event, async () => {
    const { rows } = await q(`SELECT DISTINCT to_char(starts_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') AS date
      FROM sessions WHERE NOT is_test ORDER BY date`);
    const dates = [...new Set([...(event.id === 3 ? legacyReportingDays.map((day) => day.date) : []), ...rows.map((row) => row.date)])].sort();
    event.check_in_days = dates.map((date, index) => ({ date, label: `Absensi Hari-${index + 1}`,
      shortDate: new Date(`${date}T12:00:00Z`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' }) }));
    next();
  });
});

export { currentEvent, eventId, publicEvent, searchPathSql };
