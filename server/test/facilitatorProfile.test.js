import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFacilitatorProfiles } from '../src/facilitatorProfile.js';
const row = { code: 'F-ONE', name: 'Fasil Satu', venue: 'Venue A', room: 'Ruang 1' };
const venues = [{ id: 1, name: 'Venue A' }, { id: 2, name: 'Venue B' }];
test('creates one profile per person and venue despite repeated school assignments', () => {
  const plan = planFacilitatorProfiles({ facilitators: [row, row] }, [], venues);
  assert.equal(plan.total, 1);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0].venue_id, 1);
  assert.equal(plan.inserts[0].ruangan, 'Ruang 1');
  const existing = { ...plan.inserts[0], role: 'peserta', position: 'Fasilitator Pelaporan' };
  assert.equal(planFacilitatorProfiles({ facilitators: [row] }, [existing], venues).inserts.length, 0);
  const duplicate = planFacilitatorProfiles({ facilitators: [row, { ...row, code: 'F-ALIAS' }] }, [existing], venues);
  assert.equal(duplicate.inserts.length, 0);
  assert.equal(duplicate.codes.get('F-ALIAS'), row.code);
});
test('rejects code collisions and ambiguous identities instead of overwriting profiles', () => {
  const profile = { code: row.code, name: row.name, venue_id: 1, role: 'peserta', position: 'Fasilitator Pelaporan' };
  assert.throws(() => planFacilitatorProfiles({ facilitators: [row] }, [profile, profile], venues), /ganda/);
  assert.throws(() => planFacilitatorProfiles({ facilitators: [row] }, [{ ...profile, venue_id: 2 }], venues), /sudah digunakan/);
  assert.throws(() => planFacilitatorProfiles({ facilitators: [row] }, [{ ...profile, position: 'Bendahara' }], venues), /perlu diperiksa/);
});
