import test from 'node:test';
import assert from 'node:assert/strict';
import { groupPksVerifiers } from './pksVerifiers.js';

test('verifier tab fills missing contact from authorized school rows in the same venue', () => {
  const assignments=[{code:'V1',name:'M. Mulkan',venue:'Novotel',coordinator:'Faisal',lo:'Andri'}];
  const schools=[{venue:'Novotel',facilitator:'M Mulkan',facilitator_phone:'081234567890',coordinator:'Faisal',coordinator_phone:'081234567891'},
    {venue:'Atria',facilitator:'M Mulkan',facilitator_phone:'089999999999'}];
  const [row]=groupPksVerifiers(assignments,schools);
  assert.equal(row.phone,'081234567890');
  assert.equal(row.coordinator_phone,'081234567891');
  assert.equal(assignments[0].phone,undefined);
  assert.equal(groupPksVerifiers([],schools).length,0);
});

test('conflicting school contacts are not selected arbitrarily', () => {
  const assignments=[{name:'Dio',venue:'Hotel'}];
  const schools=['081111111111','082222222222'].map(phone=>({venue:'Hotel',facilitator:'Dio',facilitator_phone:phone}));
  assert.equal(groupPksVerifiers(assignments,schools)[0].phone,undefined);
});

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
