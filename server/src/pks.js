import { loadRevitProgressJson } from './revitProgressJson.js';
import { progressLabels, progressStages, progressStage } from '../../shared/pksProgress.js';
import { Router } from 'express';
import { q } from './db.js';
import { eventId } from './eventContext.js';
import { ah, HttpError } from './util.js';
import { cleanBimtekRecord } from './pksBimtek.js';
import { createAsyncCache } from './asyncCache.js';
import { getSchoolArrivalStatuses } from './arrivalRecap.js';

export const pksRoutes = Router();
export const publicPksRoutes = Router();
const progressRoutes = Router();
pksRoutes.use('/progress', progressRoutes);
publicPksRoutes.use('/progress', progressRoutes);

publicPksRoutes.get('/', ah(async (_req, res) => {
  if (eventId() !== 5) throw new HttpError(404, 'Rekap ini hanya tersedia untuk Bimtek PKS SPAB.');
  const { rows: [roster] } = await q('SELECT data FROM assignment_roster WHERE id=1');
  const data = roster?.data;
  const schools = data?.schools?.length ? await getSchoolArrivalStatuses(data.schools) : [];
  res.json({
    schools: schools.map(({ npsn, name, provinsi, kab_kota, venue, facilitator, coordinator, lo, arrival_attendees }) => ({
      npsn, name, provinsi, kab_kota, venue, facilitator, coordinator, lo,
      arrival_attendees: arrival_attendees.map(({ name, role, status }) => ({ name, role, status })),
      arrival_statuses: [...new Set(arrival_attendees.map(({ status }) =>
        status === 'selesai' ? 'sudah_tiba' : status))],
      pks: { status: data.pks_records?.[npsn]?.status || 'belum_diterima' },
    })),
    verifiers: (data?.facilitators || []).map(({ name, venue, lo, coordinator }) => ({ name, venue, lo, coordinator })),
    lo: (data?.lo || []).map(({ name, venue }) => ({ name, venue })),
    venues: data?.venues || [],
    coordinators: (data?.coordinators || []).map(({ name, venue }) => ({ name, venue })),
  });
}));
export const pksStatuses = ['belum_diterima', 'menunggu_verifikasi', 'perlu_perbaikan', 'lengkap'];

const progressMetrics = progressLabels;
const staleWarning='Revit sementara tidak tersedia. Menampilkan data terakhir yang berhasil dimuat; data ini belum diperbarui.';
const progressCache = createAsyncCache({ ttl: 300000, maxEntries: 3, staleIfError:1800000,
  describeStale:value=>Object.assign(value instanceof Map?new Map(value):Array.isArray(value)?[...value]:{...value},
    {stale:true,warning:staleWarning}) });
function loadProgressExport() {
  return progressCache.get('export', loadRevitProgressJson);
}
async function loadProgressSchools() {
  const data=await loadProgressExport();
  return Object.assign([...data.schools],data.stale?{stale:true}:{});
}

const metricForProgressStatus = progressStage;

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
  const schools = await getSchoolArrivalStatuses(data.schools.filter(allowed));
  res.json({ schools: schools.map(row => ({ ...row, bimtek: data.bimtek_records?.[row.npsn] || null, pks: data.pks_records?.[row.npsn] || { status: 'belum_diterima' } })), verifiers: data.facilitators.filter(allowed),
    lo: req.user.role === 'admin' ? data.lo.map(({ account_id, venue_id, ...row }) => row) : own ? [{ name: own.name, venue: own.venue }] : [],
    venues: req.user.role === 'admin' ? data.venues : own ? [own.venue] : [],
    coordinators: (data.coordinators || []).filter(row => req.user.role === 'admin'
      || data.schools.some(school => allowed(school) && school.venue === row.venue && school.coordinator === row.name)) });
}));

progressRoutes.get('/', ah(async (_req, res) => {
  if (eventId() !== 5) throw new HttpError(404, 'Rekap ini hanya tersedia untuk Bimtek PKS SPAB.');
  const {schools,...source}=await loadProgressExport();
  res.set('Cache-Control', 'private, max-age=60');
  res.json(source);
}));

progressRoutes.get('/schools', ah(async (req, res) => {
  if (eventId() !== 5) throw new HttpError(404, 'Rekap ini hanya tersedia untuk Bimtek PKS SPAB.');
  const metric = String(req.query.metric || 'total');
  const hotel = String(req.query.hotel || '');
  const query = String(req.query.q || '').trim();
  const page = Number(req.query.page || 1);
  if (!progressMetrics.some(([key]) => key === metric)) throw new HttpError(400, 'Tahap progres tidak valid.');
  if (hotel.length > 120 || query.length > 120 || !Number.isSafeInteger(page) || page < 1 || page > 1000) throw new HttpError(400, 'Filter daftar sekolah tidak valid.');
  const source=await loadProgressExport();
  const term=query.toLocaleLowerCase('id');
  const rows=source.schools.filter(row=>(!hotel || row.hotel===hotel)
    && (!term || [row.npsn,row.name,row.kabKota].some(value=>value.toLocaleLowerCase('id').includes(term)))
    && (metric==='total' || (metric==='tidak_terdata'?row.stage===metric:row.achieved.includes(metric))));
  const pageSize=20;
  res.set('Cache-Control', 'private, max-age=60');
  res.json({rows:rows.slice((page-1)*pageSize,page*pageSize),total:rows.length,metric,hotel,page,pageSize,
    ...(source.stale?{stale:true,warning:staleWarning}:{})});
}));

progressRoutes.get('/lo-ranking', ah(async (_req, res) => {
  if (eventId() !== 5) throw new HttpError(404, 'Rekap ini hanya tersedia untuk Bimtek PKS SPAB.');
  const ranking = await progressCache.get('lo-ranking', async () => {
    const [rosterResult, source] = await Promise.all([
      q('SELECT data FROM assignment_roster WHERE id=1'),
      loadProgressExport(),
    ]);
    const roster = rosterResult.rows[0]?.data;
    if (!roster?.schools || !roster?.lo) throw new HttpError(503, 'Data penugasan LO belum tersedia.');
    const sourceSchools = source.schools;
    const achievements = new Map(sourceSchools.map(row=>[row.npsn,new Set(row.achieved)]));
    const schoolByNpsn = new Map(roster.schools.map(school => [String(school.npsn), school]));
    const ownerByName = new Map(roster.lo.map(owner => [`${owner.venue}:${owner.name}`, {
      name: owner.name, venue: owner.venue, total: 0, assignedNpsn: new Set(),
      metrics: Object.fromEntries(progressMetrics.filter(([key]) => key !== 'total').map(([key]) => [key, 0])),
      scoreTotal: 0, scoredSchools: 0, seen: new Set(),
    }]));
    for (const school of roster.schools) {
      ownerByName.get(`${school.venue}:${school.lo}`)?.assignedNpsn.add(String(school.npsn));
    }
    const stages = progressStages;
    for (const item of sourceSchools) {
      const school = schoolByNpsn.get(item.npsn);
      if (!school) continue;
      const owner = ownerByName.get(`${school.venue}:${school.lo}`);
      if (!owner || owner.seen.has(item.npsn)) continue;
      owner.seen.add(item.npsn);
      owner.total++;
      const achieved = achievements.get(item.npsn) || new Set();
      for (const target of achieved) owner.metrics[target]++;
      const stage = item.stage ?? metricForProgressStatus(item.status);
      const score = stage === 'tidak_terdata' || (!stage && !achieved.size) ? null : achieved.size * 100 / stages.length;
      if (score != null) {
        owner.scoreTotal += score;
        owner.scoredSchools++;
      }
    }
    const owners = [...ownerByName.values()].map(({ seen, assignedNpsn, scoreTotal, scoredSchools, ...owner }) => ({
      ...owner,
      total: assignedNpsn.size,
      overall: scoredSchools ? scoreTotal / scoredSchools : null,
      matched: owner.total,
    })).sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1) || a.name.localeCompare(b.name, 'id'));
    let previous = null, rank = 0;
    owners.forEach((owner, index) => {
      if (owner.overall !== previous || index === 0) rank = index + 1;
      previous = owner.overall;
      owner.rank = owner.overall == null ? null : rank;
    });
    return { source: source.source, updatedAt: source.updatedAt, owners, totalSourceSchools: sourceSchools.length,
      ...(source.stale?{stale:true,warning:staleWarning}:{}) };
  });
  res.set('Cache-Control', 'private, max-age=60');
  res.json(ranking);
}));

progressRoutes.get('/statuses', ah(async (req, res) => {
  if (eventId() !== 5) throw new HttpError(404, 'Rekap ini hanya tersedia untuk Bimtek PKS SPAB.');
  const rosterResult = await q('SELECT data FROM assignment_roster WHERE id=1');
  const roster = rosterResult.rows[0]?.data;
  const own = req.user?.role === 'lo' ? roster?.lo?.find(row => row.account_id === req.user.lo) : null;
  const allowed = new Set((roster?.schools || [])
    .filter(row => !req.user || req.user.role === 'admin' || (own && row.venue === own.venue && row.lo === own.name))
    .map(row => String(row.npsn)));
  // One cached export supplies every stage and school.
  const schools = await loadProgressSchools([{ hotel: '' }]);
  res.json({...Object.fromEntries(schools.filter(row => allowed.has(row.npsn)).map(row => [row.npsn, {
    stage: row.stage ?? metricForProgressStatus(row.status), label: row.status,
    achieved: row.achieved,
  }])),...((schools.stale)?{_meta:{stale:true,warning:staleWarning}}:{})});
}));

pksRoutes.put('/:npsn/bimtek', ah(async (req,res) => {
  if (eventId() !== 5) throw new HttpError(404,'Pendampingan ini hanya untuk BIMTEK PKS.');
  if (!/^\d{8}$/.test(req.params.npsn)) throw new HttpError(400,'NPSN tidak valid.');
  const record={...cleanBimtekRecord(req.body,req.user.role==='admin'),updated_at:new Date().toISOString(),updated_by:req.user.name || 'Admin utama'};
  const {rows}=await q(`UPDATE assignment_roster r SET data=jsonb_set(r.data,'{bimtek_records}',
    COALESCE(r.data->'bimtek_records','{}'::jsonb) || jsonb_build_object($1::text,$2::jsonb))
    WHERE r.id=1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.data->'schools') s
      WHERE s->>'npsn'=$1 AND ($3::boolean OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(r.data->'lo') l WHERE (l->>'account_id')::int=$4
          AND l->>'name'=s->>'lo' AND l->>'venue'=s->>'venue')))
    RETURNING id`,[req.params.npsn,JSON.stringify(record),req.user.role==='admin',req.user.lo]);
  if (!rows.length) throw new HttpError(403,'Sekolah tidak ada dalam penugasan Anda.');
  res.json(record);
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
