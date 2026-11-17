const nameKey = (value) => String(value || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function planFacilitatorProfiles(roster, people, venues) {
  const venueIds = new Map(venues.map((venue) => [venue.name, venue.id]));
  const profiles = new Map();
  const inserts = [];
  const codes = new Map();
  for (const row of roster.facilitators || []) {
    const venue_id = venueIds.get(row.venue);
    if (!venue_id || !row.code || !nameKey(row.name)) throw new Error(`Pemetaan fasilitator tidak lengkap: ${row.name}`);
    const key = `${venue_id}:${nameKey(row.name)}`;
    if (profiles.has(key)) {
      if (profiles.get(key).code !== row.code) codes.set(row.code, profiles.get(key).code);
      continue;
    }
    const matches = people.filter((person) => person.venue_id === venue_id && nameKey(person.name) === nameKey(row.name) && !person.archived_at);
    if (matches.length > 1) throw new Error(`Profil fasilitator ganda: ${row.name}`);
    const existing = matches[0];
    if (existing && (existing.role !== 'peserta' || !/^fasil/i.test(existing.position || ''))) {
      throw new Error(`Profil fasilitator perlu diperiksa: ${row.name}`);
    }
    if (!existing) {
      if (people.some((person) => person.code.toLowerCase() === row.code.toLowerCase()) || inserts.some((person) => person.code.toLowerCase() === row.code.toLowerCase())) {
        throw new Error(`Kode fasilitator sudah digunakan: ${row.name}`);
      }
      inserts.push({ code: row.code, name: row.name, venue_id, institution: row.institution || null,
        ruangan: row.room || null, phone: row.phone || null });
    }
    if (existing && existing.code !== row.code) codes.set(row.code, existing.code);
    profiles.set(key, { ...row, code: existing?.code || row.code });
  }
  return { inserts, codes, total: profiles.size, existing: profiles.size - inserts.length };
}

export async function ensureRosterFacilitatorProfiles(query) {
  const { rows: [roster] } = await query('SELECT data FROM assignment_roster WHERE id=1 FOR UPDATE');
  if (!roster) throw new Error('Pemetaan fasilitator belum tersedia.');
  const { rows: people } = await query('SELECT code,name,role,position,venue_id,archived_at FROM people');
  const { rows: venues } = await query('SELECT id,name FROM venues');
  const plan = planFacilitatorProfiles(roster.data, people, venues);
  if (plan.inserts.length) await query(`INSERT INTO people(code,name,role,position,venue_id,institution,ruangan,phone,roster_added_at)
    SELECT code,name,'peserta','Fasilitator Pelaporan',venue_id,institution,ruangan,phone,now()
    FROM jsonb_to_recordset($1::jsonb) AS f(code text,name text,venue_id int,institution text,ruangan text,phone text)`, [JSON.stringify(plan.inserts)]);
  if (plan.codes.size) {
    function rewrite(value) {
      if (Array.isArray(value)) return value.map(rewrite);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) =>
        [k, k === 'code' && plan.codes.has(v) ? plan.codes.get(v) : rewrite(v)]));
      return value;
    }
    await query('UPDATE assignment_roster SET data=$1::jsonb WHERE id=1', [JSON.stringify(rewrite(roster.data))]);
  }
  return { created: plan.inserts.length, existing: plan.existing, total: plan.total, linked_codes: plan.codes.size };
}
