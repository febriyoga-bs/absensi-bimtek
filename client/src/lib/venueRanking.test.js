import test from 'node:test';
import assert from 'node:assert/strict';
import { rankVenues } from './venueRanking.js';

test('compares percentages rather than venue size and breaks ties by acceptance', () => {
  const schools = [
    { venue: 'Besar', status: 'diterima' }, { venue: 'Besar', status: 'belum_kirim' },
    { venue: 'Kecil', status: 'menunggu_reviu' }, { venue: 'Diterima', status: 'diterima' },
    { venue: 'Kosong', status: 'belum_ada_data' }, { venue: 'Tak dikenal', status: null },
  ].map((row) => ({ ...row, submitted_on: '2026-11-17' }));
  const before = structuredClone(schools);
  const rows = rankVenues(schools, ['Belum diimpor'], '2026-11-17');
  assert.deepEqual(rows.slice(0, 3).map((r) => [r.name, r.rank, r.ratio]),
    [['Diterima', 1, 100], ['Kecil', 2, 100], ['Besar', 3, 50]]);
  assert.ok(rows.slice(3).every((r) => r.rank === null && r.sent === 0));
  assert.deepEqual(schools, before);
});

test('missing monitoring remains in the denominator', () => {
  const [row] = rankVenues([{ venue: 'A', status: 'ditolak', submitted_on: '2026-11-17' }, { venue: 'A', status: 'belum_ada_data' }], [], '2026-11-17');
  assert.equal(row.ratio, 50);
  assert.equal(row.known, 1);
  assert.equal(row.total, 2);
});

test('movement percentage wins over historical submissions and excludes missing dates', () => {
  const schools = [
    {venue:'Historis',status:'diterima',submitted_on:'2026-11-16'},
    {venue:'Historis',status:'diterima',submitted_on:'2026-11-16'},
    {venue:'Bergerak',status:'menunggu_reviu',submitted_on:'2026-11-17'},
    {venue:'Bergerak',status:'belum_ada_data'},
    {venue:'Tanpa tanggal',status:'diterima'},
  ];
  const rows = rankVenues(schools, [], '2026-11-17');
  assert.equal(rows[0].name,'Bergerak');
  assert.equal(rows[0].ratio,50);
  assert.equal(rows.find(r=>r.name==='Historis').ratio,0);
  assert.equal(rows.find(r=>r.name==='Tanpa tanggal').change,0);
  assert.ok(rankVenues(schools, [], '2026-11-18').every(r=>r.change===0));
});
