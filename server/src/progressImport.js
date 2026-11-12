import { q } from './db.js';
import { parseRows } from './peopleImport.js';
import { HttpError } from './util.js';

export const currentProgressSql = (report, progress) => `(${progress}.npsn IS NOT NULL AND (${report}.updated_at IS NULL OR ${progress}.updated_at>=${report}.updated_at))`;
export const progressStatusSql = (report, progress) => `CASE WHEN NOT ${currentProgressSql(report,progress)} THEN COALESCE(${report}.status,'belum_ada_data')
  WHEN NOT ${progress}.sent THEN 'belum_kirim'
  WHEN NOT ${progress}.reviewed THEN 'menunggu_reviu'
  WHEN ${report}.status IN ('diterima','ditolak') THEN ${report}.status ELSE 'sudah_direviu' END`;

export function parseProgressCsv(csv, knownNpsns = null) {
  if (typeof csv !== 'string' || csv.length > 2_000_000) throw new HttpError(400,'CSV progres maksimal 2 MB setelah pemilihan kolom.');
  const [header,...body] = parseRows(csv);
  const columns = header?.map((value) => value.trim().toLowerCase()) || [];
  const required = ['npsn','capaian (%)','l7 capaian 50% terisi','l8 capaian 50% terkirim','r6 capaian 50% direviu'];
  if (required.some((name) => !columns.includes(name)) || !body.length) throw new HttpError(400,'Kolom CSV Progres Laporan Sekolah tidak lengkap.');
  const seen = new Set();
  return body.map((row,index) => {
    const get = (name) => String(row[columns.indexOf(name)] ?? '').trim();
    const npsn = get('npsn');
    if (knownNpsns && !knownNpsns.has(npsn)) return null;
    const raw = get('capaian (%)');
    const progress = raw === '' ? null : Number(raw.replace('%','').replace(',','.'));
    const flag = (name) => {
      const value=get(name).toLowerCase();
      if (!['sudah','belum'].includes(value)) throw new HttpError(400,`Indikator ${name} baris ${index+2} harus Sudah atau Belum.`);
      return value==='sudah';
    };
    if (!/^\d{8}$/.test(npsn) || seen.has(npsn) || (progress!==null && (!Number.isFinite(progress)||progress<0||progress>100))) {
      throw new HttpError(400,`NPSN atau capaian baris ${index+2} tidak valid/duplikat.`);
    }
    seen.add(npsn);
    const indicators = {};
    columns.forEach((name,i) => { if (/^[plr]\d+\s/.test(name)) indicators[header[i]]=String(row[i]??'').trim(); });
    return {npsn,progress,filled:flag(required[2]),sent:flag(required[3]),reviewed:flag(required[4]),indicators};
  }).filter(Boolean);
}

export async function importProgressCsv(csv) {
  const {rows:schools}=await q(`SELECT DISTINCT s.npsn FROM assignment_roster r
    CROSS JOIN LATERAL jsonb_to_recordset(r.data->'schools') AS s(npsn text) WHERE r.id=1`);
  const incoming=parseProgressCsv(csv,new Set(schools.map(s=>s.npsn)));
  const totalRows=parseRows(csv).length-1;
  if (!incoming.length) throw new HttpError(400,'Tidak ada NPSN yang cocok dengan sekolah binaan BIMTEK.');
  const {rows:[result]}=await q(`WITH incoming AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS i(npsn text,progress numeric,filled boolean,sent boolean,reviewed boolean,indicators jsonb)
  ), known AS (
    SELECT DISTINCT s.npsn FROM assignment_roster r CROSS JOIN LATERAL jsonb_to_recordset(r.data->'schools') AS s(npsn text) WHERE r.id=1
  ), saved AS (
    INSERT INTO school_progress_report(npsn,progress,filled,sent,reviewed,indicators)
    SELECT i.* FROM incoming i JOIN known k USING(npsn)
    ON CONFLICT(npsn) DO UPDATE SET progress=EXCLUDED.progress,filled=EXCLUDED.filled,sent=EXCLUDED.sent,
      reviewed=EXCLUDED.reviewed,indicators=EXCLUDED.indicators,updated_at=now()
    RETURNING *
  ) SELECT (SELECT count(*)::int FROM saved) AS updated,
    (SELECT count(*)::int FROM incoming i LEFT JOIN known k USING(npsn) WHERE k.npsn IS NULL) AS skipped,
    (SELECT count(*)::int FROM known k LEFT JOIN incoming i USING(npsn) WHERE i.npsn IS NULL) AS unchanged,
    (SELECT count(*)::int FROM saved WHERE sent) AS sent,
    (SELECT count(*)::int FROM saved WHERE reviewed) AS reviewed,
    (SELECT count(*)::int FROM saved WHERE NOT sent AND progress>=50) AS ready`,[JSON.stringify(incoming)]);
  if (!result.updated) throw new HttpError(400,'Tidak ada NPSN yang cocok dengan sekolah binaan BIMTEK.');
  return {...result,skipped:result.skipped+totalRows-incoming.length,source:'progress',imported:totalRows,defaulted:0,contacts_updated:0};
}
