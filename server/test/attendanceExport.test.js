import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { attendanceExportLoCtes } from '../src/attendanceExport.js';

test('bulk export matches the previous LO rules, including organizations and absent rosters', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE people(id int, code text, name text, role text, position text, venue_id int, npsn text);
      CREATE TABLE lo_accounts(id int, name text, venue_id int, active boolean);
      CREATE TABLE assignment_roster(id int, data jsonb);
      INSERT INTO lo_accounts VALUES (1,'Ani',1,true),(2,'Budi',1,true),(3,'Nonaktif',1,false),(4,'Venue lain',2,true),(5,'Ani',1,true);
      INSERT INTO people VALUES
        (1,'CODE','Siti, S.Pd.','peserta',' Bendahara ',1,'123; 456'),
        (2,'NEW','Siti S Pd','peserta','bendahara',1,'456'),
        (3,'CODE','Nama lain','peserta','Bendahara',1,'123'),
        (4,'CODE','Siti S Pd','peserta','Pengawas',1,'123'),
        (5,'CODE','Siti S Pd','peserta','Bendahara',2,'123'),
        (6,'ORG','Dinas','peserta',' Dinas Pendidikan ',1,NULL),
        (7,'BPMP','BPMP','peserta','BB/BPMP',1,NULL),
        (8,'CODE','Siti S Pd','panitia','Bendahara',1,'123'),
        (9,'NO','Tanpa penugasan','peserta','Bendahara',1,NULL),
        (10,'CODE','Siti S Pd','peserta','Bendahara',NULL,'123');
    `);
    const assignment = { code: 'code', name: 'Siti S Pd', position: 'bendahara', npsn: '123;456', venue_id: 1 };
    await db.query('INSERT INTO assignment_roster VALUES(1,$1)', [JSON.stringify({ attendance_assignments: {
      1: [assignment, assignment], 2: [{ ...assignment, code: 'different' }],
      3: [assignment], 4: [assignment], 5: [assignment],
    } })]);
    const bulk = () => db.query(`WITH ${attendanceExportLoCtes}
      SELECT p.id, assigned.assigned_lo FROM people p
      LEFT JOIN export_assigned_lo assigned ON assigned.person_id=p.id ORDER BY p.id`);
    const expected = ['Ani; Budi','Ani; Budi',null,null,null,'Ani; Budi','Ani; Budi',null,null,null];
    assert.deepEqual((await bulk()).rows.map(row => row.assigned_lo), expected);
    // Missing assignment data must still include venue owners for Dinas and BPMP.
    await db.exec('DELETE FROM assignment_roster');
    const withoutRoster = (await bulk()).rows.map(row => row.assigned_lo);
    assert.deepEqual(withoutRoster, expected.map((value, index) => [5,6].includes(index) ? value : null));
  } finally { await db.close(); }
});
