import test from 'node:test';
import assert from 'node:assert/strict';
import { sortTableRows } from './tableSort.js';

const row = (key, value) => ({ key, sortValues: [value] });
test('sorts percentages numerically across all pages without changing the source', () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(String(i), 100 - i * 5));
  const original = rows.map((r) => r.key);
  assert.equal(sortTableRows(rows, 0)[0].sortValues[0], 45);
  assert.deepEqual(rows.map((r) => r.key), original);
});
test('keeps missing progress last in either direction and treats zero as data', () => {
  const rows = [row('missing', null), row('zero', 0), row('half', 50)];
  assert.deepEqual(sortTableRows(rows, 0).map((r) => r.key), ['zero', 'half', 'missing']);
  assert.deepEqual(sortTableRows(rows, 0, 'desc').map((r) => r.key), ['half', 'zero', 'missing']);
});
test('uses natural text ordering and keeps equal-value rows stable', () => {
  const rows = [row('ten', 'Sekolah 10'), row('two-a', 'Sekolah 2'), row('two-b', 'Sekolah 2')];
  assert.deepEqual(sortTableRows(rows, 0).map((r) => r.key), ['two-a', 'two-b', 'ten']);
});
test('preserves the default order until a column is selected', () => {
  const rows = [row('b', 2), row('a', 1)];
  assert.equal(sortTableRows(rows, null), rows);
});
