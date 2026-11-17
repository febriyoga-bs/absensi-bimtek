import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { getLoProfile } from '../src/loProfile.js';

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
