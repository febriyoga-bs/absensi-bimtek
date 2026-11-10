import { createHash } from 'node:crypto';
import { HttpError } from './util.js';

const POSITIONS = ['bendahara', 'pengawas'];
const FIELDS = ['venue_id', 'ruangan', 'npsn', 'institution', 'provinsi', 'kab_kota', 'ptn',
  'koor_pelaporan', 'fasil_pelaporan'];
const position = (p) => String(p.position || '').trim().toLowerCase();
const identity = (name) => name.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const schoolIds = (p) => [...new Set([
  ...String(p.npsn || '').split(';').map((n) => n.trim()).filter((n) => /^\d{8}$/.test(n)),
  ...((p.code.match(/^[bp]-(\d{8})$/i) || []).slice(1)),
])];

export function planParticipantSync(source, people, venues) {
  const venueByName = new Map(venues.map((v) => [v.name, v]));
  const venueById = new Map(venues.map((v) => [v.id, v.name]));
  const byCode = new Map(people.map((p) => [p.code.toLowerCase(), p]));
  const current = people.filter((p) => p.role === 'peserta' && POSITIONS.includes(position(p)) && schoolIds(p).length);
  const bySchool = new Map();
  for (const p of current) {
    for (const npsn of schoolIds(p)) {
      const key = `${position(p)}:${npsn}`;
      if (!bySchool.has(key)) bySchool.set(key, []);
      bySchool.get(key).push(p);
    }
  }

  const references = new Map();
  const matches = source.map((p) => {
    const venue = venueByName.get(p.venue);
    if (!venue) throw new HttpError(409, `Venue "${p.venue}" belum tersedia. Perbarui venue sebelum sinkronisasi.`);
    const candidates = new Set(schoolIds(p).flatMap((npsn) => bySchool.get(`${position(p)}:${npsn}`) || []));
    for (const candidate of candidates) references.set(candidate.id, (references.get(candidate.id) || 0) + 1);
    return { p, venue, candidates: [...candidates], owner: byCode.get(p.code.toLowerCase()) };
  });

  const items = [];
  const inserts = [];
  const updates = [];
  const archives = [];
  let unchanged = 0;
  for (const { p, venue, candidates, owner } of matches) {
    const [existing] = candidates;
    const row = {
      code: existing?.code || p.code, name: p.name, position: p.position, npsn: p.npsn,
      from_venue: venueById.get(existing?.venue_id) ?? null, to_venue: venue.name,
      from_room: existing?.ruangan ?? null, to_room: p.ruangan,
    };
    const next = Object.fromEntries(FIELDS.map((key) => [key, key === 'venue_id' ? venue.id : (p[key] ?? null)]));
    const reason = candidates.length > 1 || (existing && references.get(existing.id) > 1)
      ? 'NPSN bertaut ke beberapa data peserta.'
      : owner && owner.id !== existing?.id ? 'Kode peserta sudah digunakan oleh data lain.'
        : existing && identity(existing.name) !== identity(p.name) ? 'Nama berbeda pada NPSN yang sama.' : '';
    if (reason) {
      items.push({ ...row, action: 'review', reason, candidates: candidates.map(({ code, name }) => ({ code, name })) });
    } else if (!existing) {
      inserts.push({ ...next, code: p.code, name: p.name, position: p.position });
      items.push({ ...row, action: 'add' });
    } else if (existing.archived_at || FIELDS.some((key) => (existing[key] ?? null) !== next[key])) {
      updates.push({ ...next, id: existing.id });
      items.push({ ...row, action: 'update', name: existing.name, restored: !!existing.archived_at });
    } else {
      unchanged++;
    }
  }
  for (const p of current) {
    if (p.archived_at || references.has(p.id)) continue;
    archives.push(p.id);
    items.push({
      action: 'archive', code: p.code, name: p.name, position: p.position, npsn: p.npsn,
      from_venue: venueById.get(p.venue_id) ?? null, to_venue: null, from_room: p.ruangan ?? null, to_room: null,
    });
  }
  const summary = {
    add: inserts.length, update: updates.length, archive: archives.length,
    review: items.filter((row) => row.action === 'review').length, unchanged,
    moved: items.filter((row) => row.action === 'update' && row.from_venue !== row.to_venue).length,
  };
  const revision = createHash('sha256').update(JSON.stringify({ items, inserts, updates, archives })).digest('hex');
  return { summary, revision, items, inserts, updates, archives };
}

export async function getParticipantPlan(db) {
  const { rows: [roster] } = await db.query("SELECT data->'participants' AS participants FROM assignment_roster WHERE id=1");
  if (!roster?.participants?.length) throw new HttpError(409, 'Pemetaan peserta belum diimpor ke database.');
  const { rows: people } = await db.query(
    `SELECT id, code, name, role, position, archived_at, ${FIELDS.join(', ')} FROM people ORDER BY id`);
  const { rows: venues } = await db.query('SELECT id, name FROM venues ORDER BY id');
  return planParticipantSync(roster.participants, people, venues);
}

export async function applyParticipantPlan(db, plan) {
  const types = FIELDS.map((key) => `${key} ${key === 'venue_id' ? 'int' : 'text'}`).join(', ');
  const fields = FIELDS.join(', ');
  if (plan.inserts.length) {
    await db.query(
      `INSERT INTO people (code, name, position, role, roster_added_at, ${fields})
       SELECT code, name, position, 'peserta', now(), ${fields}
       FROM jsonb_to_recordset($1::jsonb) AS x(code text, name text, position text, ${types})`,
      [JSON.stringify(plan.inserts)]);
  }
  if (plan.updates.length) {
    await db.query(
      `UPDATE people p SET archived_at=NULL, ${FIELDS.map((key) => `${key}=x.${key}`).join(', ')}
       FROM jsonb_to_recordset($1::jsonb) AS x(id int, ${types}) WHERE p.id=x.id`,
      [JSON.stringify(plan.updates)]);
  }
  if (plan.archives.length) {
    await db.query('UPDATE people SET archived_at=now() WHERE id=ANY($1::int[])', [plan.archives]);
  }
}
