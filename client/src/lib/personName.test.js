import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personName } from './personName.js';

test('formats personal names while preserving the LO abbreviation', () => {
  assert.equal(personName('adinda saphira rizky'), 'Adinda Saphira Rizky');
  assert.equal(personName('LO SAHLATUNNISA YASSAAR RAPINDA'), 'LO Sahlatunnisa Yassaar Rapinda');
  assert.equal(personName('lo adinda saphira rizky'), 'LO Adinda Saphira Rizky');
  assert.equal(personName('Lo'), 'LO');
  assert.equal(personName('lola bagus'), 'Lola Bagus');
});
