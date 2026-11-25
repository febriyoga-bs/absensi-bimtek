import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalSchoolOverride, schoolHeadOverride } from '../src/arrivalSchoolOverrides.js';

test('confirmed Mardian spelling correction identifies only NPSN 10206644', () => {
  const row = { venue: 'Atria Tangerang', name: 'MARDIAN RIO CHANDRA HADINATA LUBIS', institution: 'UPTD SD NEGERI 153003 HUDOPA NAUULI 1' };
  assert.equal(arrivalSchoolOverride(row), '10206644');
  assert.equal(arrivalSchoolOverride({ ...row, name: 'Peserta lain' }), null);
  assert.equal(arrivalSchoolOverride({ ...row, venue: 'Novotel Mangga Dua' }), null);
  assert.equal(arrivalSchoolOverride({ ...row, institution: 'UPTD SD NEGERI 153004 HUDOPA NAUULI 2' }), null);
});

test('Ramatsyah is the confirmed head only for NPSN 10101744', () => {
  assert.equal(schoolHeadOverride('10101744'), 'Ramatsyah');
  assert.equal(schoolHeadOverride('10102130'), null);
});

test('latest mapping fills missing heads and preserves future database changes', () => {
  assert.equal(schoolHeadOverride('10102125', ''), 'Asnan');
  assert.equal(schoolHeadOverride('10101768', 'Rosnawati'), 'Aderai');
  assert.equal(schoolHeadOverride('10106810', 'Deliana'), 'Usni Yanto');
  assert.equal(schoolHeadOverride('10101744', 'Kepala Sekolah Baru'), null);
  assert.equal(schoolHeadOverride('99999999', 'Rosnawati'), null);
});
