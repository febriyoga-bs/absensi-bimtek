import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { attendanceRankingSql } from '../src/attendanceRankingSql.js';

test('ranking and drilldowns preserve assignment, session and recorder boundaries', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE venues(id int,name text);
      CREATE TABLE lo_accounts(id int,name text,venue_id int);
      CREATE TABLE assignment_roster(id int,data jsonb);
      CREATE TABLE sessions(id int,role text,venue_ids int[],is_test boolean);
      CREATE TABLE people(id int,name text,code text,position text,npsn text,venue_id int,role text,archived_at timestamptz,institution text);
      CREATE TABLE attendance(id int,person_id int,session_id int,venue_id int,scanned_by text,method text,status text,created_at timestamptz,participant_note text);
      INSERT INTO venues VALUES(1,'Venue A'),(2,'Venue B');
      INSERT INTO lo_accounts VALUES(1,'Owner',1),(2,'Duplicate',1),(3,'Duplicate',1),(4,'Empty',2);
      INSERT INTO sessions VALUES(1,'peserta','{1}',false),(2,'semua','{}',false),(3,'peserta','{}',true),(4,'panitia','{}',false),(5,'peserta','{2}',false);
      INSERT INTO people VALUES
        (1,'Person A','A','Kepala Sekolah','00000001',1,'peserta',NULL,'School'),
        (2,'Person B','B','Bendahara','00000002; 00000003',1,'peserta',NULL,'School'),
        (3,'Person C','C','Verifikator','00000004',1,'peserta',NULL,'School'),
        (4,'Person D','D','Pengawas','00000005',1,'peserta',NULL,'School'),
        (5,'Person E','E','Bendahara','00000006',1,'peserta',now(),'School'),
        (6,'Wrong Name','F','Bendahara','00000007',1,'peserta',NULL,'School'),
        (7,'Person G','G','Bendahara','00000008',2,'peserta',NULL,'School'),
        (8,'Person H','H','Bendahara',NULL,1,'panitia',NULL,'School'),
        (9,'Person I','I','Dinas Pendidikan',NULL,1,'peserta',NULL,'School');
      INSERT INTO attendance VALUES
        (1,1,1,1,'LO Owner','qr','valid','2026-11-26 08:00Z',NULL),
        (2,2,1,1,'LO Owner','manual','berhalangan','2026-11-26 08:00Z','Unavailable'),
        (3,3,1,1,NULL,'self','valid','2026-11-26 08:00Z',NULL),
        (4,4,1,1,'LO Owner','manual','ditolak','2026-11-26 08:00Z',NULL),
        (5,3,2,1,'LO Owner','qr','review','2026-11-25 08:00Z',NULL),
        (6,2,2,1,'LO Owner','manual','valid','2026-11-25 08:00Z',NULL),
        (7,4,3,1,'LO Owner','qr','valid','2026-11-26 08:00Z',NULL),
        (8,4,2,2,'LO Owner','qr','valid','2026-11-26 08:00Z',NULL),
        (9,1,2,1,'LO Duplicate','qr','valid','2026-11-26 08:00Z',NULL);`);
    const { rows: people } = await db.query('SELECT * FROM people ORDER BY id');
    const mappings = people.map(p => ({ ...p, name: p.id === 6 ? 'Other Name' : p.name,
      code: p.id === 2 ? 'replaced-code' : p.code, npsn: p.id === 2 ? '00000003;00000002' : p.npsn }));
    await db.query('INSERT INTO assignment_roster VALUES(1,$1)', [JSON.stringify({ attendance_assignments: {
      1: [...mappings, mappings[0]], 2: [mappings[0]], 3: [mappings[0]],
    } })]);
    const summary = (await db.query(attendanceRankingSql(), [1])).rows;
    assert.deepEqual(summary.find(r => r.id === 1), { id: 1, name: 'Owner', venue: 'Venue A',
      assigned: 4, present: 2, participants: 1, facilitators: 0, total: 1, unavailable: 1, unavailable_absent: 1 });
    for (const id of [2, 3]) assert.equal(summary.find(r => r.id === id).total, 0, 'ambiguous recorder names earn no credit');
    assert.equal(summary.find(r => r.id === 4).assigned, 0);
    const expected = { assigned: [1,2,3,4], present: [1,3], target: [1,3], completed: [1,2],
      unavailable: [2], participants: [1], facilitators: [] };
    for (const [metric, ids] of Object.entries(expected)) {
      const result = await db.query(attendanceRankingSql(metric), [1,1]);
      assert.deepEqual(result.rows.map(r => r.id), ids, metric);
    }
    for (const session of [4,5]) {
      const result = await db.query(attendanceRankingSql(), [session]);
      assert.ok(result.rows.every(r => r.assigned === 0 && r.total === 0));
    }
    const all = (await db.query(attendanceRankingSql(), [null])).rows.find(r => r.id === 1);
    assert.deepEqual([all.assigned,all.present,all.total,all.participants,all.facilitators,all.unavailable], [4,3,3,2,1,0]);
  } finally { await db.close(); }
});
