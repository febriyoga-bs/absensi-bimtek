import test from 'node:test';
import assert from 'node:assert/strict';
import { rankPksOwners } from './pksRanking.js';

test('ranks completed verification by percentage, deduplicates schools and isolates venues', () => {
  const schools = [
    { npsn: '1', venue: 'A', lo: 'Ana', pks: { status: 'lengkap' } },
    { npsn: '1', venue: 'A', lo: 'Ana', pks: { status: 'lengkap' } },
    { npsn: '2', venue: 'A', lo: 'Ana', pks: { status: 'menunggu_verifikasi' } },
    { npsn: '3', venue: 'A', lo: 'Budi', pks: { status: 'lengkap' } },
    { npsn: '4', venue: 'B', lo: 'Ana', pks: { status: 'perlu_perbaikan' } },
  ];
  const owners = [{ name: 'Ana', venue: 'A' }, { name: 'Budi', venue: 'A' }, { name: 'Ana', venue: 'B' }, { name: 'Citra', venue: 'A' }];
  const rows = rankPksOwners(schools, owners);
  assert.deepEqual(rows.map(row => [row.name, row.venue, row.completed, row.total, row.ratio]), [
    ['Budi', 'A', 1, 1, 100], ['Ana', 'A', 1, 2, 50], ['Ana', 'B', 0, 1, 0], ['Citra', 'A', 0, 0, null],
  ]);
  assert.equal(rows[3].rank, null);
  assert.equal(rankPksOwners(schools, owners, 'B').length, 1);
});
