import test from 'node:test';
import assert from 'node:assert/strict';
import { rankVenues } from './venueRanking.js';

test('compares percentages rather than venue size and breaks ties by acceptance', () => {
  const schools = [
    { venue: 'Besar', status: 'diterima' }, { venue: 'Besar', status: 'belum_kirim' },
    { venue: 'Kecil', status: 'menunggu_reviu' }, { venue: 'Diterima', status: 'diterima' },
    { venue: 'Kosong', status: 'belum_ada_data' }, { venue: 'Tak dikenal', status: null },
  ];
  const before = structuredClone(schools);
  const rows = rankVenues(schools, ['Belum diimpor']);
  assert.deepEqual(rows.slice(0, 3).map((r) => [r.name, r.rank, r.ratio]),
    [['Diterima', 1, 100], ['Kecil', 2, 100], ['Besar', 3, 50]]);
  assert.ok(rows.slice(3).every((r) => r.rank === null && r.sent === 0));
  assert.deepEqual(schools, before);
});

test('missing monitoring remains in the denominator', () => {
  const [row] = rankVenues([{ venue: 'A', status: 'ditolak' }, { venue: 'A', status: 'belum_ada_data' }]);
  assert.equal(row.ratio, 50);
  assert.equal(row.known, 1);
  assert.equal(row.total, 2);
});
