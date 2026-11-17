import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { getLoProfile,ensureRosterLoProfiles } from '../src/loProfile.js';

test('imported LO can obtain a stable profile without overwriting other identities', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE lo_accounts (id int,username text,name text,venue_id int,active boolean);
      CREATE TABLE people (id serial PRIMARY KEY,code text,name text,role text,position text,
        venue_id int,roster_added_at timestamptz,archived_at timestamptz);
      CREATE UNIQUE INDEX people_code_uq ON people (lower(code));
      INSERT INTO lo_accounts VALUES (1,'LO.Dara','Dara Puspa Pertiwi',4,true),
        (2,'inactive','Inactive',4,false),(3,'occupied','Other',4,true);
      INSERT INTO people (code,name,role,position,venue_id)
        VALUES ('OCCUPIED','Existing participant','peserta','Bendahara',4);`);
    const query = (sql, params) => db.query(sql, params);
    assert.equal(await getLoProfile({ lo: 1, venue: 3 }, query), undefined);
    assert.equal(await getLoProfile({ lo: 2, venue: 4 }, query), undefined);
    const profile = await getLoProfile({ lo: 1, venue: 4 }, query);
    assert.equal(profile.name, 'Dara Puspa Pertiwi');
    assert.equal(profile.role, 'panitia');
    assert.equal(profile.position, 'LO');
    assert.equal((await getLoProfile({ lo: 1, venue: 4 }, query)).id, profile.id);
    assert.equal(await getLoProfile({ lo: 3, venue: 4 }, query), undefined);
    await db.query('UPDATE people SET archived_at=now() WHERE id=$1', [profile.id]);
    assert.equal(await getLoProfile({ lo: 1, venue: 4 }, query), undefined);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM people')).rows[0].n, 2);
  } finally { await db.close(); }
});

test('roster backfill creates only missing active assigned profiles and is repeatable',async()=>{
  const db=new PGlite();try{
    await db.exec(`CREATE TABLE lo_accounts(id int,username text,name text,venue_id int,active boolean);
      CREATE TABLE people(id serial PRIMARY KEY,code text,name text,role text,position text,venue_id int,roster_added_at timestamptz);
      CREATE UNIQUE INDEX people_code_uq ON people(lower(code));
      CREATE TABLE assignment_roster(id int,data jsonb);
      INSERT INTO lo_accounts VALUES(1,'LO.Existing','New display spelling',4,true),(2,'LO.Missing','Missing',4,true),(3,'LO.Inactive','Inactive',4,false),(4,'LO.Unassigned','Unassigned',4,true);
      INSERT INTO people(code,name,role,position,venue_id) VALUES('LO.Existing','Original historical name','panitia','LO',4);
      INSERT INTO assignment_roster VALUES(1,'{"lo":[{"account_id":1,"venue_id":4},{"account_id":2,"venue_id":4},{"account_id":3,"venue_id":4}]}');`);
    const query=(sql,params)=>db.query(sql,params);
    const created=await ensureRosterLoProfiles(query);
    assert.equal(created.rows.length,1);assert.equal(created.rows[0].code,'LO.Missing');
    assert.equal((await ensureRosterLoProfiles(query)).rows.length,0);
    assert.equal((await db.query('SELECT name FROM people WHERE id=1')).rows[0].name,'Original historical name');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM people')).rows[0].n,2);
  }finally{await db.close();}
});
