import { Router } from 'express';
import { q } from './db.js';
import { eventId } from './eventContext.js';
import { ah, HttpError } from './util.js';
import { cleanBimtekRecord } from './pksBimtek.js';
import { createAsyncCache } from './asyncCache.js';

export const pksRoutes = Router();
export const pksStatuses = ['belum_diterima', 'menunggu_verifikasi', 'perlu_perbaikan', 'lengkap'];

const progressSourceUrl = 'https://revitsd.kemendikdasmen.go.id/spab/dashboard-progress?jenis=pks&bimtek=1';
const progressSchoolUrl = 'https://revitsd.kemendikdasmen.go.id/spab/dashboard-progress/sekolah';
const progressMetrics = [
  ['total', 'Total sekolah'],
  ['belum_login', 'Belum login'],
  ['bio_belum', 'Belum mengisi biodata'],
  ['bio_proses', 'Proses mengisi biodata'],
  ['bio_tunggu', 'Menunggu verifikasi biodata'],
  ['bio_ok', 'Sudah verifikasi biodata'],
  ['sepakat_rab', 'Sepakat RAB'],
  ['ba', 'TTD BA'],
  ['pks', 'TTE Kepsek PKS'],
  ['pks_ppk', 'TTE PPK PKS'],
  ['meterai', 'E-Meterai'],
  ['tidak_terdata', 'Tidak terdata'],
];
const progressCache = createAsyncCache({ ttl: 120000, maxEntries: 3 });
const decodeHtml = (value) => String(value || '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
  .replace(/&ndash;|&#8211;/g, '–').replace(/&mdash;|&#8212;/g, '—')
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const htmlText = (value) => decodeHtml(String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
const parseNumber = (value) => Number(String(value || '').replace(/\./g, '').replace(/,/g, '.').replace(/[^\d.-]/g, '')) || 0;

function parseProgressSchoolPage(html) {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, row]) => {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(([, cell]) => cell);
    if (cells.length < 4) return null;
    const identity = htmlText(cells[0]);
    const npsn = identity.match(/NPSN\s*(\d{8})/i)?.[1];
    if (!npsn) return null;
    const name = identity.replace(/\s*NPSN\s*\d{8}.*$/i, '').trim();
    return { npsn, name, kabKota: htmlText(cells[1]), hotel: htmlText(cells[2]), status: htmlText(cells[3]) };
  }).filter(Boolean);
  const totalMatch = htmlText(html).match(/\d[\d.]*\s*[–-]\s*\d[\d.]*\s+dari\s+([\d.]+)\s+sekolah/i);
  return { rows, total: totalMatch ? parseNumber(totalMatch[1]) : rows.length };
}

async function fetchProgressSchoolPage(hotel, page, metric = 'total', query = '') {
  const url = new URL(progressSchoolUrl);
  url.search = new URLSearchParams({ jenis: 'pks', bimtek: '1', metric, hotel, q: query, page: String(page) });
  const response = await fetch(url, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new HttpError(502, 'Daftar sekolah dari dashboard Revit tidak dapat diakses.');
  return parseProgressSchoolPage(await response.text());
}

async function fetchAllProgressSchools(hotels) {
  const firstPages = await Promise.all(hotels.map(hotel => fetchProgressSchoolPage(hotel.hotel, 1)));
  const jobs = [];
  firstPages.forEach((page, hotelIndex) => {
    const pageSize = Math.max(1, page.rows.length);
    const pages = Math.ceil(page.total / pageSize);
    for (let pageNumber = 2; pageNumber <= pages; pageNumber++) jobs.push({ hotel: hotels[hotelIndex].hotel, page: pageNumber });
  });
  const results = [...firstPages.flatMap(page => page.rows)];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(6, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const index = cursor++;
      const job = jobs[index];
      const page = await fetchProgressSchoolPage(job.hotel, job.page);
      results.push(...page.rows);
    }
  });
  await Promise.all(workers);
  return results;
}

function loadProgressSchools(hotels) {
  return progressCache.get('schools', () => fetchAllProgressSchools(hotels));
}

function metricForProgressStatus(status) {
  const value = String(status || '').toLocaleLowerCase('id').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (value.includes('belum login')) return 'belum_login';
  if (value.includes('belum mengisi biodata')) return 'bio_belum';
  if (value.includes('proses mengisi biodata')) return 'bio_proses';
  if (value.includes('menunggu verifikasi biodata')) return 'bio_tunggu';
  if (value.includes('sudah verifikasi biodata')) return 'bio_ok';
  if (value.includes('sepakat rab')) return 'sepakat_rab';
  if (value.includes('ttd ba') || value.includes('tanda tangan ba')) return 'ba';
  if (value.includes('tte kepsek pks')) return 'pks';
  if (value.includes('tte ppk pks')) return 'pks_ppk';
  if (value.includes('e-meterai') || value.includes('e meterai')) return 'meterai';
  if (value.includes('tidak terdata')) return 'tidak_terdata';
  return null;
}

function parseProgressPage(html) {
  const metricList = [...html.matchAll(/<button\b(?=[^>]*data-progress-open)([^>]*)>([\s\S]*?)<\/button>/gi)]
    .filter(([, attrs]) => /data-hotel=""/i.test(attrs));
  const summary = metricList.map(([, attrs, body]) => {
    const metric = attrs.match(/data-metric="([^"]+)"/i)?.[1];
    const label = htmlText(body.match(/<span[^>]*>([\s\S]*?)<\/span>/i)?.[1])
      || decodeHtml(attrs.match(/data-title="([^"]*)"/i)?.[1] || '');
    const value = body.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1];
    const percent = body.match(/<span[^>]*text-xs[^>]*>([^<]*%)<\/span>/i)?.[1] || '0%';
    return metric ? { metric, label, value: parseNumber(htmlText(value)), percent: htmlText(percent) } : null;
  }).filter(Boolean);

  const hotels = [...html.matchAll(/<tr\b[^>]*class="[^"]*hover:bg-soft[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, row]) => {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(([, cell]) => cell);
    if (!cells.length) return null;
    const metrics = Object.fromEntries(progressMetrics.map(([key]) => [key, 0]));
    cells.slice(1).forEach((cell) => {
      const metric = cell.match(/data-metric="([^"]+)"/i)?.[1];
      const buttonValue = cell.match(/<button\b[^>]*>([\s\S]*?)<\/button>/i)?.[1];
      const spanValue = cell.match(/<span[^>]*>([\s\S]*?)<\/span>/i)?.[1];
      if (metric && Object.hasOwn(metrics, metric)) metrics[metric] = parseNumber(htmlText(buttonValue));
      else if (spanValue) {
        const index = cells.indexOf(cell);
        const key = progressMetrics[index - 1]?.[0];
        if (key) metrics[key] = parseNumber(htmlText(spanValue));
      }
    });
    return { hotel: htmlText(cells[0]), metrics };
  }).filter((row) => row?.hotel);

  if (!summary.length || !hotels.length) throw new HttpError(502, 'Struktur data dashboard progress sumber berubah.');
  const updatedAt = html.match(/diperbarui\s*([^<]+)/i)?.[1]?.trim() || null;
  return { source: progressSourceUrl, updatedAt: htmlText(updatedAt), metrics: summary, hotels };
}

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
  res.json({ schools: data.schools.filter(allowed).map(row => ({ ...row, bimtek: data.bimtek_records?.[row.npsn] || null, pks: data.pks_records?.[row.npsn] || { status: 'belum_diterima' } })), verifiers: data.facilitators.filter(allowed),
    lo: req.user.role === 'admin' ? data.lo.map(({ account_id, venue_id, ...row }) => row) : own ? [{ name: own.name, venue: own.venue }] : [],
    venues: req.user.role === 'admin' ? data.venues : own ? [own.venue] : [],
    coordinators: (data.coordinators || []).filter(row => req.user.role === 'admin'
      || data.schools.some(school => allowed(school) && school.venue === row.venue && school.coordinator === row.name)) });
}));

pksRoutes.get('/progress', ah(async (_req, res) => {
  if (eventId() !== 5) throw new HttpError(404, 'Rekap ini hanya tersedia untuk Bimtek PKS SPAB.');
  const response = await fetch(progressSourceUrl, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new HttpError(502, 'Dashboard progress sumber tidak dapat diakses.');
  const html = await response.text();
  res.set('Cache-Control', 'private, max-age=60');
  res.json(parseProgressPage(html));
}));

pksRoutes.get('/progress/schools', ah(async (req, res) => {
  if (eventId() !== 5) throw new HttpError(404, 'Rekap ini hanya tersedia untuk Bimtek PKS SPAB.');
  const metric = String(req.query.metric || 'total');
  const hotel = String(req.query.hotel || '');
  const query = String(req.query.q || '').trim();
  const page = Number(req.query.page || 1);
  if (!progressMetrics.some(([key]) => key === metric)) throw new HttpError(400, 'Tahap progres tidak valid.');
  if (hotel.length > 120 || query.length > 120 || !Number.isSafeInteger(page) || page < 1 || page > 1000) throw new HttpError(400, 'Filter daftar sekolah tidak valid.');
  const result = await fetchProgressSchoolPage(hotel, page, metric, query);
  res.set('Cache-Control', 'private, max-age=60');
  res.json({ ...result, metric, hotel, page, pageSize: result.rows.length });
}));

pksRoutes.get('/progress/lo-ranking', ah(async (_req, res) => {
  if (eventId() !== 5) throw new HttpError(404, 'Rekap ini hanya tersedia untuk Bimtek PKS SPAB.');
  const ranking = await progressCache.get('lo-ranking', async () => {
    const [rosterResult, sourceResponse] = await Promise.all([
      q('SELECT data FROM assignment_roster WHERE id=1'),
      fetch(progressSourceUrl, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(15000) }),
    ]);
    if (!sourceResponse.ok) throw new HttpError(502, 'Dashboard progress sumber tidak dapat diakses.');
    const source = parseProgressPage(await sourceResponse.text());
    const roster = rosterResult.rows[0]?.data;
    if (!roster?.schools || !roster?.lo) throw new HttpError(503, 'Data penugasan LO belum tersedia.');
    const sourceSchools = await loadProgressSchools(source.hotels);
    const schoolByNpsn = new Map(roster.schools.map(school => [String(school.npsn), school]));
    const ownerByName = new Map(roster.lo.map(owner => [`${owner.venue}:${owner.name}`, {
      name: owner.name, venue: owner.venue, total: 0, assignedNpsn: new Set(),
      metrics: Object.fromEntries(progressMetrics.filter(([key]) => key !== 'total').map(([key]) => [key, 0])),
      scoreTotal: 0, scoredSchools: 0, seen: new Set(),
    }]));
    for (const school of roster.schools) {
      ownerByName.get(`${school.venue}:${school.lo}`)?.assignedNpsn.add(String(school.npsn));
    }
    const stages = ['belum_login', 'bio_belum', 'bio_proses', 'bio_tunggu', 'bio_ok', 'sepakat_rab', 'ba', 'pks', 'pks_ppk', 'meterai'];
    for (const item of sourceSchools) {
      const school = schoolByNpsn.get(item.npsn);
      if (!school) continue;
      const owner = ownerByName.get(`${school.venue}:${school.lo}`);
      if (!owner || owner.seen.has(item.npsn)) continue;
      owner.seen.add(item.npsn);
      owner.total++;
      const metric = metricForProgressStatus(item.status);
      if (metric && Object.hasOwn(owner.metrics, metric)) owner.metrics[metric]++;
      const stageIndex = stages.indexOf(metric);
      if (stageIndex >= 0) {
        owner.scoreTotal += (stageIndex / (stages.length - 1)) * 100;
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
    return { source: source.source, updatedAt: source.updatedAt, owners, totalSourceSchools: sourceSchools.length };
  });
  res.set('Cache-Control', 'private, max-age=60');
  res.json(ranking);
}));

pksRoutes.get('/progress/statuses', ah(async (req, res) => {
  if (eventId() !== 5) throw new HttpError(404, 'Rekap ini hanya tersedia untuk Bimtek PKS SPAB.');
  const [rosterResult, response] = await Promise.all([
    q('SELECT data FROM assignment_roster WHERE id=1'),
    fetch(progressSourceUrl, { signal: AbortSignal.timeout(15000) }),
  ]);
  if (!response.ok) throw new HttpError(502, 'Dashboard progress sumber tidak dapat diakses.');
  const { hotels } = parseProgressPage(await response.text());
  const roster = rosterResult.rows[0]?.data;
  const own = roster?.lo?.find(row => row.account_id === req.user.lo);
  const allowed = new Set((roster?.schools || [])
    .filter(row => req.user.role === 'admin' || (own && row.venue === own.venue && row.lo === own.name))
    .map(row => String(row.npsn)));
  const schools = await loadProgressSchools(hotels);
  res.json(Object.fromEntries(schools.filter(row => allowed.has(row.npsn)).map(row => [row.npsn, {
    stage: metricForProgressStatus(row.status), label: row.status,
  }])));
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
