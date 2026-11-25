import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalSchoolOverride } from '../src/arrivalSchoolOverrides.js';

test('confirmed Mardian spelling correction identifies only NPSN 10206644', () => {
  const row = { venue: 'Atria Tangerang', name: 'MARDIAN RIO CHANDRA HADINATA LUBIS', institution: 'UPTD SD NEGERI 153003 HUDOPA NAUULI 1' };
  assert.equal(arrivalSchoolOverride(row), '10206644');
  assert.equal(arrivalSchoolOverride({ ...row, name: 'Peserta lain' }), null);
  assert.equal(arrivalSchoolOverride({ ...row, venue: 'Novotel Mangga Dua' }), null);
  assert.equal(arrivalSchoolOverride({ ...row, institution: 'UPTD SD NEGERI 153004 HUDOPA NAUULI 2' }), null);
});
