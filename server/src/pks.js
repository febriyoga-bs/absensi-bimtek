import { Router } from 'express';
import { q } from './db.js';
import { eventId } from './eventContext.js';
import { ah, HttpError } from './util.js';

export const pksRoutes = Router();
export const pksStatuses = ['belum_diterima', 'menunggu_verifikasi', 'perlu_perbaikan', 'lengkap'];
export function cleanPksRecord(body) {
  if (!pksStatuses.includes(body?.status)) throw new HttpError(400, 'Status PKS tidak valid.');
  const record = { status: body.status };
  for (const [field, limit] of [['nomor_pks', 200], ['catatan', 4000]]) {
    if (typeof (body[field] ?? '') !== 'string' || (body[field] || '').length > limit) throw new HttpError(400, `Isian ${field} tidak valid.`);
    record[field] = (body[field] || '').trim();
  }
  for (const field of ['tanggal_diterima', 'tanggal_ttd']) {
    const value = body[field] || null;
    if (value && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new HttpError(400, 'Tanggal PKS tidak valid.');
    record[field] = value;
  }
  if (record.status === 'lengkap' && (!record.nomor_pks || !record.tanggal_ttd || !record.tanggal_diterima)) throw new HttpError(400, 'Status lengkap memerlukan nomor PKS, tanggal diterima, dan tanggal tanda tangan.');
  return record;
}
pksRoutes.get('/', ah(async (req, res) => {
  if (eventId() !== 5) throw new HttpError(404, 'Rekap ini hanya tersedia untuk Bimtek PKS SPAB.');
  const { rows: [roster] } = await q('SELECT data FROM assignment_roster WHERE id=1');
  const data = roster?.data;
  if (!data) return res.json({ schools: [], verifiers: [], lo: [], venues: [] });
  const own = req.user.role === 'lo' ? data.lo.find(row => row.account_id === req.user.lo) : null;
  const allowed = row => req.user.role === 'admin' || own && row.venue === own.venue && row.lo === own.name;
  res.json({ schools: data.schools.filter(allowed).map(row => ({ ...row, pks: data.pks_records?.[row.npsn] || { status: 'belum_diterima' } })), verifiers: data.facilitators.filter(allowed),
    lo: req.user.role === 'admin' ? data.lo.map(({ account_id, venue_id, ...row }) => row) : own ? [{ name: own.name, venue: own.venue }] : [],
    venues: req.user.role === 'admin' ? data.venues : own ? [own.venue] : [],
    coordinators: (data.coordinators || []).filter(row => req.user.role === 'admin'
      || data.schools.some(school => allowed(school) && school.venue === row.venue && school.coordinator === row.name)) });
}));

pksRoutes.put('/:npsn', ah(async (req, res) => {
  if (eventId() !== 5) throw new HttpError(404, 'Bukan kegiatan PKS.');
  const npsn = req.params.npsn;
  if (!/^\d{8}$/.test(npsn)) throw new HttpError(400, 'NPSN tidak valid.');
  const record = { ...cleanPksRecord(req.body), updated_at: new Date().toISOString(), updated_by: req.user.name || 'Admin utama' };
  const { rows } = await q(`UPDATE assignment_roster r SET data=jsonb_set(r.data, '{pks_records}',
    COALESCE(r.data->'pks_records','{}'::jsonb) || jsonb_build_object($1::text,$2::jsonb))
    WHERE r.id=1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.data->'schools') s
      WHERE s->>'npsn'=$1 AND ($3::boolean OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(r.data->'lo') l
        WHERE (l->>'account_id')::int=$4 AND l->>'name'=s->>'lo' AND l->>'venue'=s->>'venue'
      ))) RETURNING id`, [npsn, JSON.stringify(record), req.user.role === 'admin', req.user.lo]);
  if (!rows.length) throw new HttpError(403, 'Sekolah tidak ada dalam penugasan Anda.');
  res.json(record);
}));
