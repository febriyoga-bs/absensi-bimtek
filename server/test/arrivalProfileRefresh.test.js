import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArrivalProfileRefresh } from '../src/arrivalProfileRefresh.js';

test('a burst of 50 participant reads shares reconciliation, scoped by event and venue', async () => {
  let calls = 0;
  const gate = createArrivalProfileRefresh(async () => { calls++; });
  await Promise.all(Array.from({ length: 50 }, () => gate.refresh(5, 1)));
  assert.equal(calls, 1);
  await gate.refresh(5, 1);
  assert.equal(calls, 1);
  await gate.refresh(5, 2);
  await gate.refresh(4, 1);
  assert.equal(calls, 3);
  gate.clear();
  await gate.refresh(5, 1);
  assert.equal(calls, 4);
});

test('failed reconciliation is retried and expiry permits fresh reconciliation', async () => {
  let calls = 0;
  const gate = createArrivalProfileRefresh(async () => {
    if (++calls === 1) throw new Error('database unavailable');
  }, { ttl: -1 });
  await assert.rejects(gate.refresh(5, 1), /database unavailable/);
  await gate.refresh(5, 1);
  await gate.refresh(5, 1);
  assert.equal(calls, 3);
});

test('a mutation during reconciliation cannot cache the previous completion', async () => {
  let finish, calls = 0;
  const gate = createArrivalProfileRefresh(async () => {
    if (++calls === 1) await new Promise(resolve => { finish = resolve; });
  });
  const old = gate.refresh(5, 1);
  await Promise.resolve();
  gate.clear();
  finish();
  await old;
  await gate.refresh(5, 1);
  assert.equal(calls, 2);
});
