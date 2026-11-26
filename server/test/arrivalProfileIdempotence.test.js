import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planArrivalProfileLinks } from '../src/pksArrivalProfileLinks.js';

test('jsonb key order does not rewrite correct representatives, while changed arrival marks still update', () => {
  const school = { npsn: '00000000', name: 'Fixture School', venue: 'Fixture Venue', arrival_attendees: [
    { name: 'Fixture A', role: 'Perwakilan Sekolah', status: 'selesai' },
    { name: 'Fixture B', role: 'Perwakilan Sekolah', status: 'sedang_antre' },
  ] };
  const profiles = ['Kepala Sekolah', 'Bendahara'].map((position, index) => ({
    id: index + 1, name: `Fixture Original ${index}`, position, npsn: school.npsn,
    venue: school.venue, venue_id: 1, has_attendance: false,
  }));
  const [patch] = planArrivalProfileLinks([school], profiles, [{ venue_id: 1, marks: {}, representatives: {} }]);
  const representatives = Object.fromEntries(Object.entries(patch.representatives).map(([id, person]) =>
    [id, { role: person.role, npsn: person.npsn, name: person.name, original_name: person.original_name, confirmed: true }]));
  assert.deepEqual(planArrivalProfileLinks([school], profiles, [{ ...patch, representatives }]), []);
  const [changed] = planArrivalProfileLinks([school], profiles, [{ ...patch, representatives, marks: { ...patch.marks, 1: 'sedang_antre' } }]);
  assert.deepEqual(changed.marks, { 1: 'selesai' });
});
