import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planArrivalProfileLinks } from '../src/pksArrivalProfileLinks.js';

// Entirely synthetic fixtures: no real attendees or school identifiers.
test('jsonb key order never causes repeated recap writes, but changed marks still update', () => {
  const schools = [{ npsn: '00000000', name: 'Fixture School', venue: 'Fixture Venue', arrival_attendees: [
    { name: 'Fixture Person A', role: 'Perwakilan Sekolah', status: 'selesai' },
    { name: 'Fixture Person B', role: 'Perwakilan Sekolah', status: 'sedang_antre' },
  ] }];
  const profiles = [
    { id: 1, name: 'Fixture Original A', position: 'Kepala Sekolah' },
    { id: 2, name: 'Fixture Original B', position: 'Bendahara' },
  ].map(person => ({ ...person, npsn: '00000000', venue_id: 1, venue: 'Fixture Venue', has_attendance: false }));
  const [patch] = planArrivalProfileLinks(schools, profiles, [{ venue_id: 1, marks: {}, representatives: {} }]);
  const representatives = Object.fromEntries(Object.entries(patch.representatives).map(([id, person]) =>
    [id, { npsn: person.npsn, role: person.role, original_name: person.original_name, name: person.name, confirmed: true }]));
  assert.deepEqual(planArrivalProfileLinks(schools, profiles, [{ ...patch, representatives }]), []);
  const changed = { ...patch, representatives, marks: { ...patch.marks, 1: 'sedang_antre' } };
  const [updated] = planArrivalProfileLinks(schools, profiles, [changed]);
  assert.deepEqual(updated.marks, { 1: 'selesai' });
  assert.deepEqual(Object.keys(updated.representatives), ['1']);
});
