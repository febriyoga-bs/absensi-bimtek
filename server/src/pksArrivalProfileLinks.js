import { q } from './db.js';
import { eventId } from './eventContext.js';
import { getSchoolArrivalStatuses, arrivalVenueKey } from './arrivalRecap.js';
import { schoolIdentity } from './schoolIdentity.js';
import { pksSchoolHeadCorrections } from './pksSchoolHeadCorrections.js';

import { arrivalPersonKey } from '../../shared/pksAttendeeName.js';

export function planArrivalProfileLinks(schools, profiles, recaps) {
  const identities = new Map();
  const profilesBySchool = new Map();
  for (const profile of profiles) {
    const role = String(profile.position).toLowerCase().replace(/\s/g, '');
    if (!['kepalasekolah', 'bendahara'].includes(role)) continue;
    const identity = `${arrivalVenueKey(profile.venue)}:${String(profile.npsn || '').trim()}`;
    if (!profilesBySchool.has(identity)) profilesBySchool.set(identity, []);
    profilesBySchool.get(identity).push(profile);
  }
  for (const school of schools) {
    const identity = `${arrivalVenueKey(school.venue)}:${schoolIdentity(school.name)}`;
    if (!identities.has(identity)) identities.set(identity, new Set());
    identities.get(identity).add(String(school.npsn));
  }
  const patches = new Map();
  for (const school of schools) {
    const identity = `${arrivalVenueKey(school.venue)}:${schoolIdentity(school.name)}`;
    // The shared resolver already distinguishes exact school names and explicit
    // NPSN corrections. Do not discard its resolved participants a second time.
    const sharedIdentity=identities.get(identity)?.size !== 1
      && school.arrival_identity_ambiguous !== false;
    const candidates = profilesBySchool.get(`${arrivalVenueKey(school.venue)}:${school.npsn}`) || [];
    const sourceArrivals=school.arrival_attendees || [];
    // Keep absence evidence in the source, but it must not occupy either
    // of the two slots used by the participants who actually arrived.
    const linkableArrivals=sourceArrivals.length>2
      ? sourceArrivals.filter(p=>!['belum_tiba','belum_tercatat','berhalangan'].includes(p.status))
      : sourceArrivals;
    const arrivals = linkableArrivals.filter(p=>!sharedIdentity
      || (p.role==='Kepala Sekolah' && arrivalPersonKey(p.name)===arrivalPersonKey(school.head_name)));
    if (!candidates.length || candidates.length > 2 || !arrivals.length || arrivals.length > 2) continue;
    if (new Set(arrivals.map(p=>arrivalPersonKey(p.name))).size !== arrivals.length) continue;
    const recap = recaps.find(r => r.venue_id === candidates[0].venue_id);
    if (!recap) continue;
    const used = new Set(), assigned = new Map();
    for (const person of arrivals) {
      const names = candidates.filter(p => (person.role === 'Perwakilan Sekolah'
        || String(p.position).toLowerCase().replace(/\s/g,'') === String(person.role).toLowerCase().replace(/\s/g,''))
        && (arrivalPersonKey(p.name) === arrivalPersonKey(person.name)
          || (!p.has_attendance && arrivalPersonKey(recap.representatives?.[p.id]?.name) === arrivalPersonKey(person.name))));
      if (names.length === 1 && !used.has(names[0].id)) { assigned.set(person, names[0]); used.add(names[0].id); }
    }
    for (const person of arrivals) {
      if (assigned.has(person) || person.role === 'Perwakilan Sekolah') continue;
      const role = String(person.role).toLowerCase().replace(/\s/g, '');
      const head=arrivals.filter(p=>p.role==='Kepala Sekolah');
      const confirmedPair=arrivals.length===2 && head.length===1 && person.role==='Bendahara'
        && (arrivalPersonKey(school.head_name)===arrivalPersonKey(head[0].name)
          || candidates.some(p=>p.position==='Kepala Sekolah'
            && arrivalPersonKey(p.name)===arrivalPersonKey(head[0].name)))
        && !sharedIdentity;
      const confirmedHead=person.role==='Kepala Sekolah' && !!school.head_name
        && arrivalPersonKey(school.head_name)===arrivalPersonKey(person.name) && !sharedIdentity;
      const slots = candidates.filter(p => !used.has(p.id)
        && (!p.has_attendance || confirmedHead || (confirmedPair && /^bendahara\s*[—–-]/i.test(p.name || '')))
        && (/^(kepala sekolah|bendahara)\s*[—–-]/i.test(p.name || '')
          || (confirmedHead && !p.has_attendance
            && !!pksSchoolHeadCorrections[school.npsn]?.previous
            && arrivalPersonKey(p.name)===arrivalPersonKey(pksSchoolHeadCorrections[school.npsn].previous)
            && arrivalPersonKey(person.name)===arrivalPersonKey(pksSchoolHeadCorrections[school.npsn].name)))
        && String(p.position).toLowerCase().replace(/\s/g, '') === role);
      if (slots.length === 1) { assigned.set(person, slots[0]); used.add(slots[0].id); }
    }
    const remaining = arrivals.filter(p => !assigned.has(p) && p.role === 'Perwakilan Sekolah')
      .sort((a,b) => arrivalPersonKey(a.name).localeCompare(arrivalPersonKey(b.name)));
    // Unresolved representatives may use unused slots, but never inherit an
    // existing person's attendance, photo, or absence reason by slot order.
    const empty = candidates.filter(p => !used.has(p.id) && !p.has_attendance && !recap.representatives?.[p.id])
      .sort((a,b) => a.id - b.id);
    if (remaining.length <= empty.length) remaining.forEach((person,index) => assigned.set(person, empty[index]));
    for (const [person, profile] of assigned) {
      const replacement = { name: person.name, original_name: profile.name, role: person.role, npsn: String(school.npsn) };
      const unchanged = Object.keys(replacement).every(key => recap.representatives?.[profile.id]?.[key] === replacement[key]);
      const hasMark = ['selesai','sudah_tiba','sedang_antre','belum_tiba'].includes(person.status);
      if (unchanged && (!hasMark || recap.marks?.[profile.id] === person.status)) continue;
      if (!patches.has(profile.venue_id)) patches.set(profile.venue_id, { venue_id: profile.venue_id, imported_at: recap.imported_at, marks: {}, representatives: {} });
      const patch = patches.get(profile.venue_id);
      patch.representatives[profile.id] = replacement;
      if (hasMark) patch.marks[profile.id] = person.status;
    }
  }
  return [...patches.values()];
}

export async function linkPksArrivalProfiles(venueId = null) {
  if (eventId() !== 5) return;
  const [{rows:[roster]}, {rows:profiles}, {rows:recaps}] = await Promise.all([
    q("SELECT data->'schools' AS schools FROM assignment_roster WHERE id=1"),
    q(`SELECT p.id,p.name,p.position,p.npsn,p.venue_id,v.name AS venue,
      EXISTS(SELECT 1 FROM attendance a WHERE a.person_id=p.id) AS has_attendance
      FROM people p JOIN venues v ON v.id=p.venue_id WHERE p.role='peserta' AND p.archived_at IS NULL
      AND lower(trim(p.position)) IN ('kepala sekolah','bendahara') AND ($1::int IS NULL OR p.venue_id=$1)`, [venueId]),
    // Keep PostgreSQL microseconds for the optimistic import-version check.
    // A JS Date truncates them, causing the UPDATE to silently match no rows.
    q('SELECT venue_id,marks,representatives,imported_at::text AS imported_at FROM venue_arrival_recap WHERE ($1::int IS NULL OR venue_id=$1)', [venueId]),
  ]);
  const schools = await getSchoolArrivalStatuses(roster?.schools || [], venueId);
  const patches = planArrivalProfileLinks(schools, profiles, recaps);
  if (!patches.length) return;
  await q(`UPDATE venue_arrival_recap r SET marks=COALESCE(r.marks,'{}'::jsonb)||p.marks,
    representatives=COALESCE(r.representatives,'{}'::jsonb)||p.representatives
    FROM jsonb_to_recordset($1::jsonb) AS p(venue_id int,marks jsonb,representatives jsonb,imported_at timestamptz)
    WHERE r.venue_id=p.venue_id AND r.imported_at=p.imported_at
      AND (COALESCE(r.marks,'{}'::jsonb) IS DISTINCT FROM (COALESCE(r.marks,'{}'::jsonb)||p.marks)
        OR COALESCE(r.representatives,'{}'::jsonb) IS DISTINCT FROM (COALESCE(r.representatives,'{}'::jsonb)||p.representatives))`, [JSON.stringify(patches)]);
}
