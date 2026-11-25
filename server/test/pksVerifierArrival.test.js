import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pksVerifierArrivalSql } from '../src/pksVerifierArrival.js';

test('PKS verifiers count as arrived even without imported marks; other roles keep their status', async () => {
  const db = new PGlite();
  try {
    const { rows } = await db.query(`SELECT position, ${pksVerifierArrivalSql('p.position', 'p.status', 5)} AS status
      FROM (VALUES ('Verifikator',NULL::text),('Verifikator','belum_tiba'),('Fasilitator','sedang_antre'),
        ('Bendahara',NULL::text),('Kepala Sekolah','sedang_antre')) p(position,status)`);
    assert.deepEqual(rows.map(row => row.status), ['sudah_tiba', 'sudah_tiba', 'sudah_tiba', null, 'sedang_antre']);
    assert.equal(rows.filter(row => row.status === 'sudah_tiba').length, 3);
  } finally { await db.close(); }
});

test('other events retain imported arrival statuses', () => {
  assert.equal(pksVerifierArrivalSql('p.position', 'p.status', 4), 'p.status');
});
