import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attendanceSessionGroups, attendanceSessionTarget } from './attendanceSessionGroups.js';

const groups = ['bendahara','pengawas','dinas','bpmp','fasil','lo'].map(key => [key,key]);
const venues = [1,2].map(id => ({ id, ...Object.fromEntries(groups.map(([key]) => [key,{total:key === 'lo' ? 14 : 100}])) }));

test('panitia targets and venue categories exclude participant groups', () => {
  assert.deepEqual(attendanceSessionGroups(groups,['panitia']), [['lo','lo']]);
  assert.equal(attendanceSessionTarget({role:'panitia'},venues,groups),28);
  assert.equal(attendanceSessionTarget({role:'panitia',venue_ids:[2]},venues,groups),14);
});

test('participant sessions exclude LO; mixed and all-role days include both', () => {
  assert.equal(attendanceSessionTarget({role:'peserta'},venues,groups),1000);
  assert.equal(attendanceSessionTarget({role:'semua'},venues,groups),1028);
  assert.deepEqual(attendanceSessionGroups(groups,['panitia','peserta']),groups);
  assert.deepEqual(attendanceSessionGroups(groups,[]),groups);
});
