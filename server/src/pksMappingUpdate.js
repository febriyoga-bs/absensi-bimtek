import { createHash } from 'node:crypto';

export const mappingNameKey = value => String(value || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const clean = value => String(value || '').replace(/[\u200B\u2060\uFEFF]/g, '').trim();
const identity = row => `${row.venue}:${mappingNameKey(row.name)}`;
const codeFor = row => `PKS-V-${createHash('sha256').update(`${row.venue}:${clean(row.name)}`).digest('hex').slice(0, 16).toUpperCase()}`;

export function normalizeHeadPhone(value) {
  const raw = clean(value).replace(/^\.\s*/, '').replace(/^O(?=\d)/i, '0');
  if (!raw) return null;
  if (!/^\+?[\d\s().-]+$/.test(raw)) throw new Error('Kontak kepala sekolah mengandung karakter yang perlu diperiksa.');
  const normalized = raw.replace(/[^\d+]/g, '');
  if (!/^\+?\d{9,15}$/.test(normalized)) throw new Error('Panjang kontak kepala sekolah tidak valid.');
  return normalized;
}

export function planPksMappingUpdate(source, current) {
  const old = current.roster;
  if (source.kind !== 'pks_spab' || source.stage !== 5 || !old?.schools?.length) throw new Error('Pemetaan PKS tidak valid.');
  const sourceIds = new Set(source.schools.map(row => row.npsn));
  const oldIds = new Set(old.schools.map(row => row.npsn));
  if (sourceIds.size !== source.schools.length || sourceIds.size !== oldIds.size || [...sourceIds].some(id => !/^\d{8}$/.test(id) || !oldIds.has(id))) {
    throw new Error('Daftar NPSN berubah atau ganda; perlu periksa perubahan populasi sebelum menerapkan.');
  }
  const venues = new Map(current.venues.map(row => [row.name, row.id]));
  const accounts = new Map(current.accounts.map(row => [`${row.venue_id}:${mappingNameKey(row.name)}`, row]));
  const lo = source.lo.map(row => {
    const venue_id = venues.get(row.venue);
    const account = accounts.get(`${venue_id}:${mappingNameKey(row.name)}`);
    if (!venue_id || !account) throw new Error(`Akun atau venue LO perlu diperiksa: ${row.name}`);
    return { ...row, name: account.name, account_id: account.id, venue_id };
  });
  if (new Set(lo.map(row => row.account_id)).size !== lo.length || lo.length !== old.lo.length) throw new Error('Daftar LO berubah atau ganda.');
  const owners = new Map(lo.map(row => [identity(row), row]));
  const verifierMeta = new Map();
  for (const row of source.verifier_people) {
    if (verifierMeta.has(identity(row))) throw new Error(`Verifikator ganda: ${row.name}`);
    if (!venues.has(row.venue)) throw new Error('Venue verifikator tidak ditemukan.');
    verifierMeta.set(identity(row), { ...row, name: clean(row.name), coordinator: clean(row.coordinator) });
  }
  const coordinators = source.coordinators.map(row => ({ ...row, name: clean(row.name) }));
  const coordinatorKeys = new Set(coordinators.map(identity));
  if (coordinatorKeys.size !== coordinators.length) throw new Error('Koordinator ganda.');
  for (const row of verifierMeta.values()) if (!coordinatorKeys.has(identity({ name: row.coordinator, venue: row.venue }))) throw new Error(`Koordinator verifikator belum terpetakan: ${row.name}`);
  const updates = [], inserts = [], linkedVerifiers = new Map();
  for (const row of verifierMeta.values()) {
    const matches = current.people.filter(person => person.venue_id === venues.get(row.venue) && mappingNameKey(person.name) === mappingNameKey(row.name) && /^verifikator$/i.test(person.position || ''));
    if (matches.length > 1) throw new Error(`Profil verifikator ganda: ${row.name}`);
    const person = matches[0];
    const code = person?.code || codeFor(row);
    if (!person && (current.people.some(p => p.code.toLowerCase() === code.toLowerCase()) || inserts.some(p => p.code === code))) throw new Error('Kode verifikator sudah digunakan.');
    if (person) updates.push({ id: person.id, name: row.name, venue_id: person.venue_id, institution: person.institution,
      npsn: person.npsn, provinsi: person.provinsi, kab_kota: person.kab_kota, phone: person.phone,
      fasil_pelaporan: person.fasil_pelaporan, koor_pelaporan: row.coordinator || null, archived_at: null });
    else inserts.push({ code, name: row.name, role: 'peserta', position: 'Verifikator', venue_id: venues.get(row.venue), koor_pelaporan: row.coordinator || null });
    linkedVerifiers.set(identity(row), { ...row, code });
  }
  const newVerifierKeys = new Set(linkedVerifiers.keys());
  for (const row of old.facilitators || []) if (!newVerifierKeys.has(identity(row))) throw new Error(`Verifikator lama hilang dari sumber; perlu periksa: ${row.name}`);
  const schools = [], participants = [], attendance_assignments = {}, assignments = new Map();
  const addAssignment = (owner, row) => (attendance_assignments[owner.account_id] ||= []).push({ code: row.code, name: row.name,
    position: row.position || 'Verifikator', npsn: row.npsn || null, venue_id: owner.venue_id });
  for (const row of source.schools) {
    const owner = owners.get(identity({ venue: row.venue, name: row.lo }));
    const verifier = linkedVerifiers.get(identity({ venue: row.venue, name: row.facilitator }));
    if (!owner || !verifier || mappingNameKey(verifier.coordinator) !== mappingNameKey(row.coordinator)) throw new Error(`Penugasan sekolah tidak konsisten: ${row.npsn}`);
    const head_phone = normalizeHeadPhone(row.head_phone);
    const school = { ...row, lo: owner.name, facilitator: verifier.name, coordinator: verifier.coordinator, head_name: clean(row.head_name), head_phone: head_phone || '' };
    const correction=old.arrival_corrections?.[row.npsn];
    if (correction?.venue===row.venue) school.head_name=correction.head_name;
    schools.push(school);
    for (const position of ['Kepala Sekolah', 'Bendahara']) {
      const matches = current.people.filter(person => person.role === 'peserta' && mappingNameKey(person.position) === mappingNameKey(position)
        && String(person.npsn || '').split(';').map(id => id.trim()).includes(row.npsn) && !person.archived_at);
      if (matches.length !== 1) throw new Error(`Profil ${position} perlu diperiksa untuk NPSN ${row.npsn}`);
      const person = matches[0], head = position === 'Kepala Sekolah';
      const correctedName=correction?.venue===row.venue && correction.attendees?.find(p=>p.role===position)?.name;
      const profile = { id: person.id, name: correctedName || (head && school.head_name ? school.head_name : person.name),
        phone: head && head_phone ? head_phone : person.phone, venue_id: owner.venue_id,
        institution: row.name, npsn: row.npsn, provinsi: row.provinsi, kab_kota: row.kab_kota,
        fasil_pelaporan: verifier.name, koor_pelaporan: verifier.coordinator, archived_at: null };
      updates.push(profile);
      const participant = { ...school, code: person.code, name: profile.name, phone: profile.phone, position,
        institution: profile.institution, fasil_pelaporan: verifier.name, koor_pelaporan: verifier.coordinator };
      participants.push(participant); addAssignment(owner, participant);
    }
    const key = JSON.stringify([row.venue, verifier.code, owner.account_id]);
    if (!assignments.has(key)) { assignments.set(key, { ...verifier, lo: owner.name }); addAssignment(owner, verifier); }
  }
  return { updates, inserts, roster: { ...old, ...source, schools, lo, participants, facilitators: [...assignments.values()],
    coordinators, verifier_people: [...linkedVerifiers.values()], attendance_assignments, pks_records: old.pks_records || {},
    arrival_corrections:old.arrival_corrections || {} },
    summary: { schools: schools.length, lo: lo.length, verifiers: linkedVerifiers.size, assignments: assignments.size,
      coordinators: coordinators.length, head_names: schools.filter(row => row.head_name).length,
      head_phones: schools.filter(row => row.head_phone).length, profiles_updated: updates.length, profiles_added: inserts.length } };
}

export async function applyPksMappingPlan(query, plan) {
  await query(`UPDATE people p SET name=x.name,phone=x.phone,venue_id=x.venue_id,institution=x.institution,npsn=x.npsn,
    provinsi=x.provinsi,kab_kota=x.kab_kota,fasil_pelaporan=x.fasil_pelaporan,koor_pelaporan=x.koor_pelaporan,archived_at=NULL
    FROM jsonb_to_recordset($1::jsonb) x(id int,name text,phone text,venue_id int,institution text,npsn text,provinsi text,kab_kota text,fasil_pelaporan text,koor_pelaporan text)
    WHERE p.id=x.id`, [JSON.stringify(plan.updates)]);
  if (plan.inserts.length) await query(`INSERT INTO people(code,name,role,position,venue_id,koor_pelaporan,roster_added_at)
    SELECT code,name,role,position,venue_id,koor_pelaporan,now() FROM jsonb_to_recordset($1::jsonb)
    x(code text,name text,role text,position text,venue_id int,koor_pelaporan text)`, [JSON.stringify(plan.inserts)]);
  await query('UPDATE assignment_roster SET data=$1 WHERE id=1', [JSON.stringify(plan.roster)]);
}
