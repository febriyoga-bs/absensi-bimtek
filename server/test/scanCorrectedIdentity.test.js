import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rawPool, q, migrate } from '../src/db.js';
import { eventContext } from '../src/eventContext.js';
import { signAdmin } from '../src/auth.js';
import { invalidateEventMetadata } from '../src/events.js';
import app from '../src/app.js';

test('corrected PKS names can be checked in by their assigned LO while unrelated LO, roles and venues remain denied', async () => {
  // Synthetic PostgreSQL fixtures and local photo storage: no production calls.
  const db = new PGlite();
  const originalConnect = rawPool.connect, originalQuery = rawPool.query;
  const savedEnv = Object.fromEntries(['JWT_SECRET','R2_BUCKET','VERCEL','UPLOAD_DIR'].map(key => [key, process.env[key]]));
  const uploads = await mkdtemp(path.join(tmpdir(), 'bimtek-scope-test-'));
  let tail = Promise.resolve(), server;
  rawPool.connect = async () => {
    const previous = tail;
    let unlock;
    tail = new Promise(resolve => { unlock = resolve; });
    await previous;
    return {
      async query(sql, params) {
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
    process.env.JWT_SECRET = 'synthetic-checkin-test-secret';
    process.env.R2_BUCKET = '';
    delete process.env.VERCEL;
    process.env.UPLOAD_DIR = uploads;
    await migrate();
    await rawPool.query("INSERT INTO public.bimtek_events(id,name,schema_name,status) VALUES(5,'Fixture Event','bimtek_5','draft')");
    await migrate();
    let venue, otherVenue, owner, otherOwner, session;
    await eventContext.run({ id: 5, schema_name: 'bimtek_5' }, async () => {
      venue = (await q("INSERT INTO venues(name,lat,lng) VALUES('Fixture Venue A',0,0) RETURNING id")).rows[0].id;
      otherVenue = (await q("INSERT INTO venues(name,lat,lng) VALUES('Fixture Venue B',0,0) RETURNING id")).rows[0].id;
      owner = (await q("INSERT INTO lo_accounts(name,username,password_hash,venue_id) VALUES('Fixture LO A','fixture-lo-a','unused',$1) RETURNING id", [venue])).rows[0].id;
      otherOwner = (await q("INSERT INTO lo_accounts(name,username,password_hash,venue_id) VALUES('Fixture LO B','fixture-lo-b','unused',$1) RETURNING id", [venue])).rows[0].id;
      for (const [code, name, position, npsn, venueId] of [
        ['fixture-k','Fixture New Head','Kepala Sekolah','00000000',venue],
        ['fixture-b','Fixture New Treasurer','Bendahara','00000000',venue],
        ['fixture-supervisor','Fixture New Supervisor','Pengawas','00000000',venue],
        ['fixture-foreign','Fixture Foreign Head','Kepala Sekolah','00000001',venue],
        ['fixture-other-venue','Fixture New Head','Kepala Sekolah','00000000',otherVenue],
      ]) await q("INSERT INTO people(code,name,role,position,venue_id,npsn,institution) VALUES($1,$2,'peserta',$3,$4,$5,'Fixture School')", [code,name,position,venueId,npsn]);
      const mappings = {
        [owner]: [
          { code:'fixture-old-k',name:'Fixture Old Head',position:'Kepala Sekolah',npsn:'00000000',venue_id:venue },
          { code:'fixture-old-b',name:'Fixture Old Treasurer',position:'Bendahara',npsn:'00000000',venue_id:venue },
          { code:'fixture-supervisor',name:'Fixture Old Supervisor',position:'Pengawas',npsn:'00000000',venue_id:venue },
        ],
        [otherOwner]: [{ code:'fixture-foreign',name:'Fixture Foreign Head',position:'Kepala Sekolah',npsn:'00000001',venue_id:venue }],
      };
      await q('INSERT INTO assignment_roster(id,data) VALUES(1,$1)', [JSON.stringify({ schools:[],attendance_assignments:mappings })]);
      session = (await q("INSERT INTO sessions(name,role,starts_at,ends_at,venue_ids) VALUES('Fixture Session','peserta',now()-interval '1 hour',now()+interval '1 hour',$1) RETURNING id", [[venue,otherVenue]])).rows[0].id;
    });
    invalidateEventMetadata();
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const ownToken = signAdmin({ role:'lo',username:'fixture-lo-a',accounts:[{event:5,id:owner}] });
    const otherToken = signAdmin({ role:'lo',username:'fixture-lo-b',accounts:[{event:5,id:otherOwner}] });
    const send = (url, token, body) => fetch(`${origin}/api${url}`, { method:body ? 'POST':'GET',
      headers:{ Authorization:`Bearer ${token}`,'Content-Type':'application/json' },body:body ? JSON.stringify(body):undefined });
    const listed = await send(`/admin/scan/participants?event=5&category=sekolah`, ownToken);
    assert.equal(listed.status, 200, await listed.clone().text());
    const people = (await listed.json()).rows;
    for (const code of ['fixture-k','fixture-b']) assert.equal(people.find(person => person.code === code)?.can_check_in, true);
    const photo = Buffer.alloc(5000, 1); photo[0]=0xff; photo[1]=0xd8;
    const body = code => ({code,session_id:session,photo:`data:image/jpeg;base64,${photo.toString('base64')}`,note:'Fixture attendance'});
    for (const [code, token] of [['fixture-k',otherToken],['fixture-foreign',ownToken],['fixture-supervisor',ownToken],['fixture-other-venue',ownToken]]) {
      const denied = await send('/admin/scan?event=5', token, body(code));
      assert.equal(denied.status, 403, await denied.clone().text());
    }
    for (const code of ['fixture-k','fixture-b']) {
      const saved = await send('/admin/scan?event=5', ownToken, body(code));
      assert.equal(saved.status, 200, await saved.clone().text());
      const duplicate = await send('/admin/scan?event=5', ownToken, body(code));
      assert.equal(duplicate.status, 409, await duplicate.clone().text());
    }
    await eventContext.run({ id:5,schema_name:'bimtek_5' }, async () => {
      const { rows } = await q('SELECT scanned_by,photo_path,status FROM attendance');
      assert.equal(rows.length,2);
      assert.ok(rows.every(row => row.scanned_by === 'LO Fixture LO A' && row.photo_path && row.status === 'valid'));
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.close(); rawPool.connect=originalConnect; rawPool.query=originalQuery; await rawPool.end();
    for (const [key,value] of Object.entries(savedEnv)) { if(value===undefined)delete process.env[key];else process.env[key]=value; }
    assert.equal(path.dirname(uploads),path.resolve(tmpdir()));
    assert.ok(path.basename(uploads).startsWith('bimtek-scope-test-'));
    await rm(uploads,{recursive:true,force:true});
  }
});
