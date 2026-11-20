import test from 'node:test';
import assert from 'node:assert/strict';
import { groupPksVerifiers } from './pksVerifiers.js';

test('one verifier combines distinct LO assignments without duplicate names', () => {
  const row = { code: 'V1', name: 'M. Mulkan Adziima', venue: 'Novotel', coordinator: 'Faisal' };
  const source = ['Ahmad', 'Andri', 'Ahmad'].map(lo => ({ ...row, lo }));
  const grouped = groupPksVerifiers(source);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].los, ['Ahmad', 'Andri']);
  assert.equal(grouped[0].coordinator, 'Faisal');
  assert.equal(source[0].los, undefined);
});

test('different venues remain separate and restricted assignments are not expanded', () => {
  const source = [{ code: 'V1', name: 'Dio', venue: 'Atria', lo: 'Akbar' }, { code: 'V1', name: 'Dio', venue: 'Novotel', lo: 'Andri' }];
  assert.equal(groupPksVerifiers(source).length, 2);
  assert.deepEqual(groupPksVerifiers(source.slice(0, 1))[0].los, ['Akbar']);
  assert.deepEqual(groupPksVerifiers(), []);
});
