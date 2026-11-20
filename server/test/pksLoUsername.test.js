import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pksLoUsername } from '../src/pksLoUsername.js';

test('SPAB LO usernames use short names and skip variants of Muhammad', () => {
  assert.equal(pksLoUsername('MOCHAMAD AKBAR'), 'SPAB.LO.Akbar');
  assert.equal(pksLoUsername('Muhamad Daffa Akshana'), 'SPAB.LO.Daffa');
  assert.equal(pksLoUsername('Muhammad Fadli Pratama'), 'SPAB.LO.Fadli');
  assert.equal(pksLoUsername('Muhammad Naufal Syafrie'), 'SPAB.LO.Naufal');
  assert.equal(pksLoUsername('Naufal Athaya Ghani'), 'SPAB.LO.Athaya');
  assert.equal(pksLoUsername('ALYA ZAHRABY'), 'SPAB.LO.Alya');
});

test('duplicate given names are distinguished by another name without numbers', () => {
  const names = ['Abdul Rangga Nopa Irhaz Putra', 'Rangga Rekta Prasetia', 'Taufik Ismatullah', 'Taufik Priyatna'];
  const usernames = names.map(pksLoUsername);
  assert.equal(new Set(usernames).size, names.length);
  assert.ok(usernames.every(username => /^SPAB\.LO\.[A-Za-z]+$/.test(username)));
});
