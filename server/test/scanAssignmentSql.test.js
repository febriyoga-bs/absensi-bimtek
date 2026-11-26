import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { scanAssignmentSql } from '../src/scanAssignmentSql.js';

// Compare to the original SQL, including NULLs, shared schools, duplicate
// mappings, mismatched names, positions and venues. All data is synthetic.
test('optimized directory assignments return exactly the original permissions for every event', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE fixture_people(id int,name text,code text,position text,npsn text,venue_id int,role text,archived_at timestamptz);
      CREATE TABLE fixture_mappings(account_id int,lo_name text,venue_id int,position text,name_key text,code text,school_ids text[]);
      CREATE TABLE active_owners(id int,name text,venue_id int);`);
    const positions = ['Kepala Sekolah','Bendahara','Pengawas','Fasilitator','Dinas Pendidikan','BB/BPMP'];
    const people = Array.from({ length: 240 }, (_, i) => ({ id: i + 1, name: `Fixture Person ${i % 12}`,
      code: i % 9 ? `CODE-${i % 16}` : null, position: positions[i % positions.length],
      npsn: [null, '', '00000000', '00000001', '00000000;00000001', '00000002; 00000000'][i % 6],
      venue_id: i % 3 + 1, role: 'peserta', archived_at: null }));
    const mappings = people.map((p, i) => ({ account_id: i % 30 + 1, lo_name: `Fixture LO ${i % 30}`,
      venue_id: i % 7 ? p.venue_id : 99, position: p.position.toLowerCase(),
      name_key: i % 4 ? p.name.toLowerCase().replace(/[^a-z0-9]/g, '') : 'othername',
      code: i % 5 ? p.code?.toLowerCase() : 'other-code',
      school_ids: i % 8 ? p.npsn?.replaceAll(' ', '').split(';').filter(Boolean) ?? null : [] }));
    await db.query(`INSERT INTO fixture_people SELECT * FROM jsonb_to_recordset($1) AS p(id int,name text,code text,position text,npsn text,venue_id int,role text,archived_at timestamptz)`, [JSON.stringify(people)]);
    await db.query(`INSERT INTO fixture_mappings SELECT * FROM jsonb_to_recordset($1) AS m(account_id int,lo_name text,venue_id int,position text,name_key text,code text,school_ids text[])`, [JSON.stringify([...mappings, ...mappings.slice(0, 5)])]);
    await db.exec("INSERT INTO active_owners VALUES(1,'Fixture LO A',1),(2,'Fixture LO B',2),(3,'Fixture LO C',3)");
    const prefix = `WITH candidate_people AS MATERIALIZED (SELECT p.*,lower(trim(p.position)) AS position_key,lower(p.code) AS code_key,
      regexp_replace(lower(p.name),'[^[:alnum:]]','','g') AS name_key,string_to_array(replace(p.npsn,' ',''),';') AS school_ids FROM fixture_people p),
      mappings AS MATERIALIZED (SELECT * FROM fixture_mappings), `;
    for (const event of [3, 4, 5]) {
      const original = `assigned_people AS (SELECT DISTINCT p.id,m.account_id,m.lo_name FROM candidate_people p JOIN mappings m
        ON p.venue_id=m.venue_id AND lower(trim(p.position))=m.position
        AND (regexp_replace(lower(p.name),'[^[:alnum:]]','','g')=m.name_key OR (${event === 5} AND lower(trim(p.position)) IN ('kepala sekolah','bendahara') AND m.school_ids && string_to_array(replace(p.npsn,' ',''),';')))
        AND (lower(p.code)=m.code OR (m.school_ids IS NOT NULL AND m.school_ids && string_to_array(replace(p.npsn,' ',''),';')))
        WHERE p.role='peserta' AND p.archived_at IS NULL
        UNION SELECT p.id,l.id,l.name FROM candidate_people p JOIN active_owners l ON p.venue_id=l.venue_id
        WHERE p.role='peserta' AND p.archived_at IS NULL AND lower(trim(p.position)) IN ('dinas pendidikan','bb/bpmp'))`;
      const suffix = ' SELECT * FROM assigned_people ORDER BY id,account_id,lo_name';
      const expected = await db.query(prefix + original + suffix);
      const actual = await db.query(prefix + scanAssignmentSql(event) + suffix);
      assert.ok(expected.rows.length > 0);
      assert.deepEqual(actual.rows, expected.rows, `event ${event}`);
    }
  } finally { await db.close(); }
});
