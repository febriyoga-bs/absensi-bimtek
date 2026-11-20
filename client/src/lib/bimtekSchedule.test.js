import test from 'node:test';
import assert from 'node:assert/strict';
import { currentAndUpcomingBimtek, venueSchedulesFor } from './bimtekSchedule.js';

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

test('PKS landing venue resolves its own dates without accessing a missing reporting stage', () => {
  const schedules = venueSchedulesFor({ id: 5, name: 'PKS SPAB' });
  assert.equal(schedules.length, 1);
  const selected = schedules.find(item => item.stage === 5);
  assert.equal(selected.name, 'BIMTEK PKS SPAB');
  assert.equal(selected.dates, '23–28 November 2026');
});

test('venue dates remain available for reporting and unknown events have a safe metadata fallback', () => {
  for (const id of [2, 3, 4]) assert.ok(venueSchedulesFor({ id }).find(item => item.stage === id).dates);
  assert.deepEqual(venueSchedulesFor({ id: 6, name: 'Kegiatan baru' })[0], { stage: 6, name: 'Kegiatan baru', tabLabel: 'Kegiatan baru', dates: '' });
  assert.ok(venueSchedulesFor(null).length);
});
