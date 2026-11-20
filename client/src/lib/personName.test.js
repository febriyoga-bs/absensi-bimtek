import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personName } from './personName.js';
import { readFileSync } from 'node:fs';

test('name formatter loads without regex lookbehind required by Safari 16.4', () => {
  const source = readFileSync(new URL('./personName.js', import.meta.url), 'utf8');
  assert.ok(!source.includes('(?<!') && !source.includes('(?<='));
  assert.equal(personName('Prof. Dr. Ir. ANI S.Pd., M.Pd.'), 'Prof. Dr. Ir. Ani S.Pd., M.Pd.');
  assert.equal(personName('BAS.PDAN'), 'Bas.pdan');
});
test('formats multiple academic degrees and preserves professional title distinctions', () => {
  assert.equal(personName('BUDI, S.t., M.ars., A.md.T.'), 'Budi, S.T., M.Ars., A.Md.T.');
  assert.equal(personName('ANI, S. KOM., M.si., Ph.d.'), 'Ani, S.Kom., M.Si., Ph.D.');
  assert.equal(personName('Prof. Dr. Ir. BUDI, M.eng.'), 'Prof. Dr. Ir. Budi, M.Eng.');
  assert.equal(personName('dr. ANI'), 'dr. Ani');
  assert.equal(personName('drg. ANI'), 'drg. Ani');
  assert.equal(personName('sri komala'), 'Sri Komala');
});
test('formats S.Si and S.Pd degrees in personal names', () => {
  assert.equal(personName('ANI, S.si'), 'Ani, S.Si');
  assert.equal(personName('BUDI S.pd'), 'Budi S.Pd');
  assert.equal(personName('CITRA, S. PD., S.SI'), 'Citra, S.Pd., S.Si');
});
test('preserves BB/BPMP capitalization', () => {
  assert.equal(personName('Bb/bpmp'), 'BB/BPMP');
  assert.equal(personName('BB/BPMP JAWA TIMUR'), 'BB/BPMP Jawa Timur');
});

test('formats personal names while preserving the LO abbreviation', () => {
  assert.equal(personName('adinda saphira rizky'), 'Adinda Saphira Rizky');
  assert.equal(personName('LO SAHLATUNNISA YASSAAR RAPINDA'), 'LO Sahlatunnisa Yassaar Rapinda');
  assert.equal(personName('lo adinda saphira rizky'), 'LO Adinda Saphira Rizky');
  assert.equal(personName('Lo'), 'LO');
  assert.equal(personName('lola bagus'), 'Lola Bagus');
});

test('invisible characters copied from Excel do not prevent name capitalization', () => {
  assert.equal(personName('\u2060Dio Rafael Sinaga'), 'Dio Rafael Sinaga');
  assert.equal(personName('\u2060Fatiya Dwi Riyani'), 'Fatiya Dwi Riyani');
  assert.equal(personName('\u200bdio\u2060 rafael sinaga\ufeff'), 'Dio Rafael Sinaga');
});

test('keeps SD and PKS uppercase in school placeholders and admin names', () => {
  assert.equal(personName('Bendahara — SD 2 MUHAMMADIYAH'), 'Bendahara — SD 2 Muhammadiyah');
  assert.equal(personName('Admin Pks Satdik Aman Bencana'), 'Admin PKS Satdik Aman Bencana');
  assert.equal(personName('sd al washliyah'), 'SD Al Washliyah');
  assert.equal(personName('SD It AL HIKMAH'), 'SD IT Al Hikmah');
  assert.equal(personName('Bendahara — Sdn LUENG SA'), 'Bendahara — SDN Lueng Sa');
  assert.equal(personName('Upt SD NEGERI 105 ONAN GANJANG'), 'UPT SD Negeri 105 Onan Ganjang');
  assert.equal(personName('Uptd SD NEGERI 158506 TUKKA'), 'UPTD SD Negeri 158506 Tukka');
  assert.equal(personName('PKS-B-10105697'), 'PKS-B-10105697');
  assert.equal(personName('sdian pksari'), 'Sdian Pksari');
});
