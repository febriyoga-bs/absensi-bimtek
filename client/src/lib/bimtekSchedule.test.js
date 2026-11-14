import test from 'node:test';
import assert from 'node:assert/strict';
import { currentAndUpcomingBimtek } from './bimtekSchedule.js';

const stages = (date) => currentAndUpcomingBimtek(new Date(date)).map((item) => item.stage);

test('shows the ongoing stage first and omits completed stages', () => {
  assert.deepEqual(stages('2026-11-14T10:00:00Z'), [3, 4]);
});

test('keeps a stage through its last day and removes it at midnight WIB', () => {
  assert.deepEqual(stages('2026-11-14T16:59:59Z'), [3, 4]);
  assert.deepEqual(stages('2026-11-14T17:00:00Z'), [4]);
});

test('includes upcoming events and returns no expired fallback', () => {
  assert.deepEqual(stages('2026-11-15T10:00:00Z'), [4]);
  assert.deepEqual(stages('2026-11-21T16:59:59Z'), [4]);
  assert.deepEqual(stages('2026-11-21T17:00:00Z'), []);
});
