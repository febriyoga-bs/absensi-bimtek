import { readFileSync } from 'node:fs';
import { q } from './db.js';
import { parseRows } from './peopleImport.js';
import { HttpError } from './util.js';
import { reportingCheckInDates, reportingDates, reportingDays } from './reportingDays.js';
import { importProgressCsv, progressStatusSql, currentProgressSql } from './progressImport.js';
import { currentEvent } from './eventContext.js';

// Arsip statis dari Pantau Pelaporan LO · Bimtek K3.html. Hanya data yang dipakai dasbor.
const archive = JSON.parse(readFileSync(new URL('./reportingK3.json', import.meta.url), 'utf8'));
const statusCodes = new Set(['belum_kirim', 'menunggu_reviu', 'ditolak', 'diterima']);
const sourceStatuses = {
  belum_dikirim: 'belum_kirim', menunggu_reviu_fasil: 'menunggu_reviu', diterima_fasil: 'diterima',
  dikembalikan_fasil: 'ditolak', dikembalikan_koordinator: 'ditolak',
};
const facilitatorKey = (row, name) => JSON.stringify([row.venue, row.lo, row.room, row.group, name]);
const contactKey = (venue, name) => JSON.stringify([venue, String(name || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')]);
const phoneNameKey = (column) => `regexp_replace(lower(${column}), '[^[:alnum:]]', '', 'g')`;
function mobileNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const phone = digits.startsWith('08') ? '62' + digits.slice(1) : digits.startsWith('8') ? '62' + digits : digits;
  return /^628\d{7,11}$/.test(phone) ? phone : null;
}

export async function getPublicReporting(dataset) {
  const data = await getReporting(dataset, { role: 'public' });
  return {
    title: data.title, stamp: data.stamp, arrival_stamp: data.arrival_stamp,
    attendance_stamp: data.attendance_stamp, baseline: data.baseline,
    check_in_days: data.check_in_days, venues: data.venues,
    lo: data.lo.map(({ name, venue }) => ({ name, venue })),
    facilitators: data.facilitators.map(({ id, name, institution, coordinator, venue, lo, room }) =>
      ({ id, name, institution, coordinator, venue, lo, room })),
    schools: data.schools,
  };
}

export async function getReporting(dataset, user) {
  if (dataset === 'k3') return archive;
  if (dataset !== 'current') throw new HttpError(400, 'Kegiatan pelaporan tidak valid.');
  const [{ rows: [roster] }, { rows: records }, { rows: contacts }] = await Promise.all([
    q("SELECT data->'lo' AS lo, data->'facilitators' AS facilitators, data->'schools' AS schools FROM assignment_roster WHERE id=1"),
    q(`SELECT s.npsn, p.provinsi, p.peringkat, ${progressStatusSql('m','pr')} AS status,
       CASE WHEN ${currentProgressSql('m','pr')} AND NOT pr.sent THEN NULL ELSE to_char(m.submitted_on,'YYYY-MM-DD') END AS submitted_on,
       CASE WHEN ${currentProgressSql('m','pr')} THEN pr.progress ELSE m.progress END::float AS progress,
       GREATEST(m.updated_at,pr.updated_at) AS updated_at,
       arrival.marks->>p.id::text AS arrival_status, arrival.imported_at AS arrival_imported_at,
       ${reportingCheckInDates('p.id', 'v.id', '$1')} AS check_in_dates,
       CASE WHEN ${progressStatusSql('m','pr')}='menunggu_reviu' AND m.submitted_on IS NOT NULL
            THEN GREATEST(0, (now() AT TIME ZONE 'Asia/Jakarta')::date - m.submitted_on) END AS wait_days,
       EXISTS (SELECT 1 FROM attendance a JOIN sessions s2 ON s2.id=a.session_id AND NOT s2.is_test
         WHERE a.person_id=p.id AND a.venue_id=v.id AND a.status IN ('valid','review')) AS attended
       FROM assignment_roster r CROSS JOIN LATERAL jsonb_to_recordset(r.data->'schools') AS s(npsn text,venue text)
       LEFT JOIN venues v ON v.name=s.venue
       LEFT JOIN people p ON lower(p.code)='b-'||s.npsn AND p.role='peserta' AND lower(trim(p.position))='bendahara'
         AND p.archived_at IS NULL AND p.venue_id=v.id
       LEFT JOIN venue_arrival_recap arrival ON arrival.venue_id=v.id
       LEFT JOIN school_reporting m ON m.npsn=s.npsn
       LEFT JOIN school_progress_report pr ON pr.npsn=s.npsn WHERE r.id=1`, [reportingDates]),
    q(`SELECT v.name AS venue,p.name,p.phone FROM people p JOIN venues v ON v.id=p.venue_id
       WHERE p.role='peserta' AND p.archived_at IS NULL AND lower(trim(p.position)) LIKE 'fasil%'
         AND ($1::int IS NULL OR p.venue_id=$1)`, [user.role === 'lo' ? user.venue : null]),
  ]);
  const lo = roster?.lo || [];
  const source = new Map(records.map((row) => [row.npsn, row]));
  const own = user.role === 'lo' ? lo.find((row) => row.account_id === user.lo && row.venue_id === user.venue) : null;
  const phones = new Map();
  for (const contact of contacts) {
    const key = contactKey(contact.venue, contact.name);
    phones.set(key, phones.has(key) ? null : contact.phone);
  }
  const ids = new Map();
  const facilitators = (roster?.facilitators || []).map(({ name, institution, coordinator, venue, lo, room, group }, id) => {
    ids.set(facilitatorKey({ venue, lo, room, group }, name), id);
    const canSeeContact = user.role === 'admin' || (own?.venue === venue && own?.name === lo);
    return { id, name, institution, coordinator, venue, lo, room,
      phone: canSeeContact ? phones.get(contactKey(venue, name)) : undefined };
  });
  return {
    title: currentEvent()?.name || 'BIMTEK Tahap 3',
    baseline: reportingDates[0],
    check_in_days: reportingDays,
    stamp: records.reduce((latest, row) => row.updated_at && (!latest || row.updated_at > latest) ? row.updated_at : latest, null),
    arrival_stamp: records.reduce((latest, row) => row.arrival_imported_at && (!latest || row.arrival_imported_at > latest) ? row.arrival_imported_at : latest, null),
    own: own && { name: own.name, venue: own.venue },
    venues: [...new Set(lo.map((row) => row.venue))],
    lo: lo.map(({ name, venue }) => ({ name, venue })),
    facilitators,
    schools: (roster?.schools || []).map((row) => {
      const { npsn, name, city, venue, lo, room } = row;
      const report = source.get(npsn);
      return { npsn, name, province: report?.provinsi, city, venue, lo, room, rank: Number(report?.peringkat) || null,
        facilitator_id: ids.get(facilitatorKey(row, row.facilitator)),
        status: report?.status || 'belum_ada_data', progress: report?.progress,
        submitted_on: report?.submitted_on, wait_days: report?.wait_days,
        check_in_dates: report?.check_in_dates || [],
        venue_attendance: report?.arrival_status === 'sedang_antre' ? 'sedang_antre'
          : ['selesai', 'sudah_tiba'].includes(report?.arrival_status) ? 'sudah_tiba' : 'tidak_terdata',
        attendance: report?.attended ? 'sudah_absen' : 'belum_absen' };
    }),
  };
}

async function parseReporting(csv) {
  if (typeof csv !== 'string' || csv.length > 2_000_000) throw new HttpError(400, 'CSV yang diproses melebihi batas ukuran.');
  const [header, ...body] = parseRows(csv);
  const names = header?.map((column) => column.toLowerCase());
  const official = names?.includes('status reviu') || false;
  const columns = (official ? ['npsn', 'status reviu', 'tanggal kirim', 'capaian saat ini (%)']
    : ['npsn', 'status', 'tanggal_kirim', 'progres_fisik']).map((name) => names?.indexOf(name) ?? -1);
  if (columns[0] < 0 || columns[1] < 0 || !body.length) throw new HttpError(400, 'CSV harus memuat kolom npsn dan status serta minimal satu baris data.');
  const known = official ? new Set((await q(`SELECT s.npsn FROM assignment_roster r
    CROSS JOIN LATERAL jsonb_to_recordset(r.data->'schools') AS s(npsn text) WHERE r.id=1`)).rows.map((s) => s.npsn)) : null;
  let skipped = 0;
  const contactColumns = ['fasilitator', 'no. hp fasilitator', 'pengawas', 'no. hp pengawas'].map((column) => names.indexOf(column));
  const seen = new Set();
  const entries = [];
  for (const [i, row] of body.entries()) {
    const [npsn, rawStatus, rawDate, progress] = columns.map((index) => row[index] || '');
    if (known && !known.has(npsn)) {
      skipped++;
      continue;
    }
    const key = rawStatus.toLowerCase().replace(/\s+/g, '_').replace('review', 'reviu');
    const status = official && Object.hasOwn(sourceStatuses, key) ? sourceStatuses[key] : key;
    const date = rawDate.replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: \d{2}:\d{2}(?::\d{2})?)?$/,
      (_, day, month, year) => `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    const parsedDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date) : null;
    const value = progress ? Number(progress.replace(/%$/, '').replace(',', '.')) : null;
    if (!/^\d{8}$/.test(npsn) || seen.has(npsn) || !statusCodes.has(status)
      || (date && (!parsedDate || Number.isNaN(+parsedDate) || parsedDate.toISOString().slice(0, 10) !== date || date.startsWith('0000')))
      || (value != null && (!Number.isFinite(value) || value < 0 || value > 100))) {
      throw new HttpError(400, `Data CSV baris ${i + 2} tidak valid atau NPSN muncul lebih dari sekali.`);
    }
    seen.add(npsn);
    const [facilitator, facilitatorPhone, supervisor, supervisorPhone] = contactColumns.map((index) => row[index] || '');
    entries.push({ npsn, status, submitted_on: date || null, progress: value,
      facilitator, facilitator_phone: official ? mobileNumber(facilitatorPhone) : null,
      supervisor, supervisor_phone: official ? mobileNumber(supervisorPhone) : null });
  }
  return { entries, official, skipped };
}

export async function importReporting(csv) {
  if (typeof csv !== 'string' || csv.length > 2_000_000) throw new HttpError(400, 'CSV yang diproses melebihi batas ukuran.');
  const header = typeof csv === 'string' ? parseRows(csv)[0]?.map((name) => name.trim().toLowerCase()) : [];
  if (!header?.includes('status reviu') && header?.includes('l8 capaian 50% terkirim')) return importProgressCsv(csv);
  const { entries, official, skipped } = await parseReporting(csv);
  if (!entries.length) throw new HttpError(400, 'Tidak ada NPSN di CSV yang cocok dengan pemetaan kegiatan ini.');
  const { rows: [result] } = await q(`WITH incoming AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS i(npsn text,status text,submitted_on date,progress numeric,
      facilitator text,facilitator_phone text,supervisor text,supervisor_phone text)
  ), known AS (
    SELECT DISTINCT s.npsn, s.facilitator, v.id AS venue_id FROM assignment_roster r
    CROSS JOIN LATERAL jsonb_to_recordset(r.data->'schools') AS s(npsn text,venue text,facilitator text)
    LEFT JOIN venues v ON v.name=s.venue WHERE r.id=1
  ), unknown AS (
    SELECT i.npsn FROM incoming i LEFT JOIN known k USING (npsn) WHERE k.npsn IS NULL
  ), saved AS (
    INSERT INTO school_reporting(npsn,status,submitted_on,progress)
    SELECT k.npsn,COALESCE(i.status,'belum_kirim'),i.submitted_on,i.progress
    FROM known k LEFT JOIN incoming i USING (npsn)
    WHERE ($2::boolean OR i.npsn IS NOT NULL)
      AND ($2::boolean OR NOT EXISTS (SELECT 1 FROM unknown))
    ORDER BY k.npsn
    ON CONFLICT (npsn) DO UPDATE SET status=EXCLUDED.status, submitted_on=EXCLUDED.submitted_on,
      progress=EXCLUDED.progress, updated_at=now()
    RETURNING npsn,status
  ), candidates AS (
    SELECT min(p.id) AS id,c.phone
    FROM incoming i JOIN known k USING(npsn)
    CROSS JOIN LATERAL (VALUES
      ('fasil', i.facilitator, i.facilitator_phone), ('pengawas', i.supervisor, i.supervisor_phone)
    ) AS c(role,name,phone)
    JOIN people p ON p.role='peserta' AND p.archived_at IS NULL AND p.venue_id=k.venue_id
      AND ${phoneNameKey('p.name')}=${phoneNameKey('c.name')}
      AND ((c.role='fasil' AND lower(trim(p.position)) LIKE 'fasil%' AND ${phoneNameKey('k.facilitator')}=${phoneNameKey('c.name')})
        OR (c.role='pengawas' AND lower(trim(p.position))='pengawas' AND i.npsn=ANY(string_to_array(replace(p.npsn,' ',''),';'))))
    WHERE $2::boolean AND c.phone IS NOT NULL AND c.name<>''
    GROUP BY i.npsn,c.role,c.phone HAVING count(*)=1
  ), contacts_saved AS (
    UPDATE people p SET phone=contacts.phone
    FROM (SELECT id,min(phone) AS phone FROM candidates GROUP BY id HAVING count(DISTINCT phone)=1) contacts
    WHERE p.id=contacts.id AND nullif(trim(p.phone),'') IS NULL
    RETURNING p.id
  )
  SELECT (SELECT count(*)::int FROM saved) AS updated, (SELECT count(*)::int FROM unknown) AS skipped,
    CASE WHEN $2::boolean THEN (SELECT count(*)::int FROM known k LEFT JOIN incoming i USING(npsn) WHERE i.npsn IS NULL)
      ELSE 0 END AS defaulted,
    (SELECT count(*)::int FROM contacts_saved) AS contacts_updated,
    (SELECT count(*)::int FROM known k LEFT JOIN incoming i USING(npsn) WHERE i.npsn IS NULL) AS absent_from_file,
    (SELECT jsonb_object_agg(status, n) FROM (SELECT status,count(*)::int AS n FROM saved GROUP BY status) totals) AS status_counts,
    ARRAY(SELECT npsn FROM unknown ORDER BY npsn LIMIT 10) AS unknown`, [JSON.stringify(entries), official]);
  if (!official && result.unknown.length) throw new HttpError(400, `NPSN tidak ada di pemetaan Pelaporan 3 (${result.unknown.join(', ')}). Periksa CSV lalu coba lagi.`);
  if (!result.updated) throw new HttpError(400, 'Tidak ada NPSN di CSV yang cocok dengan pemetaan kegiatan ini.');
  return { updated: result.updated, skipped: skipped + result.skipped, contacts_updated: result.contacts_updated,
    defaulted: result.defaulted, unchanged: official ? 0 : result.absent_from_file,
    source: official ? 'review' : 'compact', imported: entries.length + skipped,
    status_counts: result.status_counts || {} };
}
