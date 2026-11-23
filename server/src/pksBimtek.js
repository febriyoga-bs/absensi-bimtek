import { assistanceTypes, rabStatuses, documentLabels } from '../../shared/pksBimtek.js';
import { HttpError } from './util.js';
export function cleanBimtekRecord(body, admin) {
  if (!body || !['negeri','swasta'].includes(body.school_type)) throw new HttpError(400,'Pilih status sekolah.');
  if (!Array.isArray(body.assistance_types) || !body.assistance_types.length || body.assistance_types.some(type => !Object.hasOwn(assistanceTypes,type))) throw new HttpError(400,'Pilih jenis bantuan yang sesuai.');
  if (!Object.hasOwn(rabStatuses,body.rab_status)) throw new HttpError(400,'Status RAB tidak valid.');
  if (!admin && ['sesuai','perlu_perbaikan'].includes(body.rab_status)) throw new HttpError(403,'Hasil reviu dicatat admin berdasarkan pemeriksaan verifikator.');
  const out={school_type:body.school_type,assistance_types:[...new Set(body.assistance_types)],documents:{},rab_status:body.rab_status};
  for (const key of Object.keys(documentLabels)) {
    if (body.documents?.[key] != null && typeof body.documents[key] !== 'boolean') throw new HttpError(400,'Checklist dokumen tidak valid.');
    out.documents[key]=body.documents?.[key] === true;
  }
  for (const key of ['internal_check','price_survey']) {
    if (body[key] != null && typeof body[key] !== 'boolean') throw new HttpError(400,'Checklist RAB tidak valid.');
    out[key]=body[key] === true;
  }
  for (const [key,max] of [['note',4000],['reviewer',200],['evidence_url',1500],['submitted_on',10],['reviewed_on',10]]) {
    if (typeof (body[key] ?? '') !== 'string' || (body[key] || '').length>max) throw new HttpError(400,'Isian pendampingan tidak valid.');
    out[key]=(body[key] || '').trim();
  }
  for (const key of ['submitted_on','reviewed_on']) if (out[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(out[key]) || !Number.isFinite(Date.parse(out[key])) || new Date(out[key]).toISOString().slice(0,10)!==out[key])) throw new HttpError(400,'Tanggal pendampingan tidak valid.');
  if (out.evidence_url) { let url; try {url=new URL(out.evidence_url);} catch {} if (!url || !['https:','http:'].includes(url.protocol)) throw new HttpError(400,'Tautan bukti harus berupa URL HTTP/HTTPS.'); }
  if (out.rab_status!=='belum_diajukan' && (!out.submitted_on || !out.internal_check || !out.price_survey || !out.evidence_url)) throw new HttpError(400,'RAB yang diajukan memerlukan tanggal, checklist internal, survei harga, dan tautan bukti.');
  if (['sesuai','perlu_perbaikan'].includes(out.rab_status) && (!out.reviewer || !out.reviewed_on || !out.note)) throw new HttpError(400,'Hasil reviu memerlukan nama verifikator, tanggal, dan catatan.');
  if (out.reviewed_on && out.submitted_on && out.reviewed_on<out.submitted_on) throw new HttpError(400,'Tanggal reviu tidak boleh mendahului pengajuan.');
  return out;
}
