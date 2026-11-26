import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { rawPool, q, migrate } from '../src/db.js';
import { eventContext } from '../src/eventContext.js';
import { signAdmin } from '../src/auth.js';
import { invalidateEventMetadata } from '../src/events.js';
import app from '../src/app.js';

test('20 concurrent participant requests preserve recap identities and perform no database writes', async () => {
  // An isolated PostgreSQL database and synthetic fixtures only.
  const db = new PGlite();
  const originalConnect = rawPool.connect, originalQuery = rawPool.query;
  let tail = Promise.resolve(), server, trackWrites = false, writes = 0;
  rawPool.connect = async () => {
    const previous = tail;
    let unlock;
    tail = new Promise(resolve => { unlock = resolve; });
    await previous;
    return {
      async query(sql, params) {
        if (trackWrites && /^\s*(UPDATE|INSERT|DELETE)\b/i.test(sql)) writes++;
        const result = params?.length ? await db.query(sql, params) : (await db.exec(sql)).at(-1);
        return { ...result, rowCount: result?.rows?.length || result?.affectedRows || 0 };
      },
      release() { unlock(); },
    };
  };
  rawPool.query = async (...args) => {
    const client = await rawPool.connect();
    try { return await client.query(...args); } finally { client.release(); }
  };
  try {
    process.env.JWT_SECRET = 'synthetic-directory-test-secret';
    await migrate();
    await rawPool.query("INSERT INTO public.bimtek_events(id,name,schema_name,status) VALUES(5,'Fixture Event','bimtek_5','draft')");
    await migrate();
    let venueId;
    await eventContext.run({ id: 5, schema_name: 'bimtek_5' }, async () => {
      const venue = (await q("INSERT INTO venues(name,lat,lng) VALUES('Fixture Venue',0,0) RETURNING id")).rows[0];
      venueId = venue.id;
      const ids = [];
      for (const [code, name, position] of [['fixture-k','Fixture Original A','Kepala Sekolah'],['fixture-b','Fixture Original B','Bendahara']]) {
        ids.push((await q("INSERT INTO people(code,name,role,position,venue_id,npsn,institution) VALUES($1,$2,'peserta',$3,$4,'00000000','Fixture School') RETURNING id", [code,name,position,venueId])).rows[0].id);
      }
      const representatives = Object.fromEntries(ids.map((id, index) => [id, {
        name: `Fixture Attendee ${index}`, original_name: `Fixture Original ${index === 0 ? 'A' : 'B'}`,
        role: 'Perwakilan Sekolah', npsn: '00000000',
      }]));
      const marks = Object.fromEntries(ids.map(id => [id, 'selesai']));
      await q('INSERT INTO venue_arrival_recap(venue_id,marks,representatives,detail_rows,imported_at) VALUES($1,$2,$3,$4,now())',
        [venueId,JSON.stringify(marks),JSON.stringify(representatives),'[]']);
    });
    invalidateEventMetadata();
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const token = signAdmin({ role: 'admin' });
    trackWrites = true;
    const results = await Promise.all(Array.from({ length: 20 }, async () => {
      const response = await fetch(`${origin}/api/admin/scan/participants?event=5&category=sekolah&venue_id=${venueId}`,
        { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    }));
    assert.equal(writes, 0);
    for (const result of results) {
      assert.equal(result.total, 2);
      assert.equal(result.arrival_summary.arrived, 2);
      assert.deepEqual(result.rows.map(person => person.representative.name).sort(), ['Fixture Attendee 0','Fixture Attendee 1']);
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.close();
    rawPool.connect = originalConnect;
    rawPool.query = originalQuery;
    await rawPool.end();
  }
});
