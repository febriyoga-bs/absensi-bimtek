import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { rawPool,q,pool,migrate } from '../src/db.js';
import { eventContext } from '../src/eventContext.js';
import { setUnifiedStorage,eventSql } from '../src/unifiedStorage.js';
import { unifyMigration } from '../src/unifyMigration.js';
import { hashPassword,signAdmin } from '../src/auth.js';
import app from '../src/app.js';
import {ensureRosterLoProfiles} from '../src/loProfile.js';

const db=new PGlite();let tail=Promise.resolve(),server,origin,summary;
rawPool.connect=async()=>{const previous=tail;let release;tail=new Promise(r=>release=r);await previous;
  return {query:async(sql,params)=>{const r=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1);return {...r,rowCount:r?.rows?.length||r?.affectedRows||0};},release};};
rawPool.query=async(sql,params)=>{const c=await rawPool.connect();try{return await c.query(sql,params);}finally{c.release();}};
const stages={2:{id:2,schema_name:'bimtek_2'},3:{id:3,schema_name:'public'},4:{id:4,schema_name:'bimtek_4'}};
const scoped=(id,fn)=>eventContext.run(stages[id],fn);
before(async()=>{
  process.env.JWT_SECRET='unified-test-secret-never-production';process.env.ADMIN_PASSWORD='test-password';
  await migrate();
  for(const id of [3,4])await scoped(id,async()=>{
    await q('INSERT INTO venues(name,lat,lng) VALUES($1,-6,106)',[`Venue ${id}`]);
    await q('INSERT INTO people(code,name,role,position,venue_id,npsn) VALUES($1,$2,$3,$4,1,$5)', ['B-12345678',`Person ${id}`,'peserta','Bendahara','12345678']);
    await q('INSERT INTO sessions(name,role,starts_at,ends_at) VALUES($1,$2,$3,$4)',[`Session ${id}`,'semua','2026-11-18T01:00:00Z','2026-11-18T09:00:00Z']);
    await q('INSERT INTO attendance(person_id,session_id,venue_id,photo_path,status) VALUES(1,1,1,$1,$2)',[`r2:events/${id}/original.jpg`,'valid']);
    await q('INSERT INTO lo_accounts(name,username,password_hash,venue_id) VALUES($1,$2,$3,1)', ['Shared Person','LO.Test',hashPassword('shared-password')]);
    await q('INSERT INTO school_reporting(npsn,status) VALUES($1,$2)',['12345678',id===3?'diterima':'belum_kirim']);
    await q('INSERT INTO assignment_roster(id,data) VALUES(1,$1)',[JSON.stringify({venues:[`Venue ${id}`],lo:[{name:'Shared Person',venue:`Venue ${id}`,venue_id:1,account_id:1}],facilitators:[],schools:[]})]);
  });
  const c=await rawPool.connect();try{await c.query('BEGIN');summary=await unifyMigration(c);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  setUnifiedStorage(true);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));origin=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));await db.close();await rawPool.end();});

test('migration verifies every copied table and preserves legacy sources and photo references',async()=>{
  assert.equal(summary.summary.length,22);assert.ok(summary.summary.every(r=>r.verified));
  assert.equal((await rawPool.query('SELECT count(*)::int AS n FROM public.people')).rows[0].n,1);
  assert.equal((await rawPool.query('SELECT count(*)::int AS n FROM bimtek_4.people')).rows[0].n,1);
  assert.equal((await rawPool.query('SELECT count(*)::int AS n FROM public.event_people')).rows[0].n,2);
  for(const id of [3,4])assert.equal((await scoped(id,()=>q('SELECT photo_path FROM attendance'))).rows[0].photo_path,`r2:events/${id}/original.jpg`);
});
test('RLS uses a non-owner role and separates equal IDs, codes, NPSNs and joins',async()=>{
  for(const id of [3,4])await scoped(id,async()=>{
    assert.equal((await q('SELECT current_user AS name')).rows[0].name,'bimtek_app');
    const data=await q('SELECT p.name,s.name AS session FROM people p JOIN attendance a ON a.person_id=p.id JOIN sessions s ON s.id=a.session_id');
    assert.deepEqual(data.rows,[{name:`Person ${id}`,session:`Session ${id}`}]);
  });
});
test('upserts and updates only modify the selected event',async()=>{
  await scoped(3,()=>q("INSERT INTO people(code,name,role) VALUES('B-12345678','Updated','peserta') ON CONFLICT(lower(code)) DO UPDATE SET name=EXCLUDED.name"));
  assert.equal((await scoped(3,()=>q('SELECT name FROM people'))).rows[0].name,'Updated');
  assert.equal((await scoped(4,()=>q('SELECT name FROM people'))).rows[0].name,'Person 4');
  await scoped(3,()=>q("INSERT INTO school_reporting(npsn,status) VALUES('12345678','ditolak') ON CONFLICT(npsn) DO UPDATE SET status=EXCLUDED.status"));
  assert.equal((await scoped(4,()=>q('SELECT status FROM school_reporting'))).rows[0].status,'belum_kirim');
  assert.equal(eventSql("SELECT 'FROM people' AS label FROM people"),"SELECT 'FROM people' AS label FROM public.event_people");
});
test('cross-event inserts fail and explicit transactions roll back without changing another activity',async()=>{
  await assert.rejects(scoped(4,()=>q("INSERT INTO people(event_id,code,name,role) VALUES(3,'NO','Forbidden','peserta')")),{code:'42501'});
  await scoped(3,()=>q("INSERT INTO people(code,name,role) VALUES('only3','Only 3','peserta')"));
  await assert.rejects(scoped(4,()=>q("INSERT INTO attendance(person_id,session_id,status) VALUES(2,1,'valid')")),{code:'23503'});
  const c=await scoped(4,()=>pool.connect());try{await c.query('BEGIN');await c.query("UPDATE people SET name='Must rollback'");await c.query('ROLLBACK');}finally{c.release();}
  assert.equal((await scoped(4,()=>q('SELECT name FROM people WHERE id=1'))).rows[0].name,'Person 4');
});
test('one login exposes all three stage tabs while keeping assignment-only actions protected',async()=>{
  await rawPool.query("UPDATE public.bimtek_events SET status=CASE WHEN id=4 THEN 'active' ELSE 'archived' END");
  const response=await fetch(origin+'/api/admin/login?event=3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'LO.Test',password:'shared-password'})});
  assert.equal(response.status,200);const login=await response.json();assert.deepEqual(login.user.events.map(e=>e.id),[2,3,4]);
  assert.equal(login.event.id,4,'active stage overrides the saved archive at login');
  const admin=await fetch(origin+'/api/admin/login?event=3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-password'})});
  assert.equal(admin.status,200);assert.equal((await admin.json()).event.id,4);
  for(const id of [2,3,4]){const me=await fetch(origin+`/api/admin/me?event=${id}`,{headers:{Authorization:`Bearer ${login.token}`}});assert.equal(me.status,200);}
  const blocked=await fetch(origin+'/api/lo/challenge?event=2',{method:'POST',headers:{Authorization:`Bearer ${login.token}`}});assert.equal(blocked.status,409);
  const archive=await fetch(origin+'/api/admin/reporting?event=2&dataset=current',{headers:{Authorization:`Bearer ${login.token}`}});assert.equal(archive.status,200);assert.ok((await archive.json()).schools.length>0);
});
test('test session recaps stay separate from official attendance and validate scope',async()=>{
  const token=signAdmin({role:'admin'}),headers={Authorization:`Bearer ${token}`};
  let testId;
  await scoped(4,async()=>{
    const {rows:[session]}=await q("INSERT INTO sessions(name,role,starts_at,ends_at,is_test) VALUES('Test recap','semua','2026-11-17T01:00:00Z','2026-11-17T09:00:00Z',true) RETURNING id");
    testId=session.id;
    const {rows:[person]}=await q("INSERT INTO people(code,name,role,position,venue_id) VALUES('TEST-P2','Only test','peserta','Bendahara',1) RETURNING id");
    await q("INSERT INTO attendance(person_id,session_id,venue_id,status) VALUES($1,$2,1,'review')",[person.id,testId]);
  });
  const read=async(path)=>{const response=await fetch(origin+path,{headers});assert.equal(response.status,200);return response.json();};
  const official=await read('/api/admin/venue-attendance?event=4');
  const testing=await read(`/api/admin/venue-attendance?event=4&test_session_id=${testId}`);
  assert.equal(official[0].bendahara.attended,1);assert.equal(testing[0].bendahara.attended,1);
  const detail=await read(`/api/admin/venue-attendance/1/bendahara?event=4&test_session_id=${testId}`);
  assert.equal(detail.find(row=>row.name==='Only test').people[0].status,'review');
  assert.equal(detail.find(row=>row.name==='Person 4').people[0].status,null);
  const tests=await read('/api/admin/sessions?event=4&test_only=1');assert.equal(tests.length,1);assert.equal(tests[0].is_test,true);
  for(const suffix of ['event=4&test_session_id=1',`event=3&test_session_id=${testId}`]){
    assert.equal((await fetch(origin+'/api/admin/venue-attendance?'+suffix,{headers})).status,404);
  }
});

test('cutover is repeatable without duplicating data',async()=>{
  const c=await rawPool.connect();try{await c.query('BEGIN');assert.equal((await unifyMigration(c)).alreadyUnified,true);await c.query('ROLLBACK');}finally{c.release();}
});

test('profile backfill is scoped to the selected event in unified storage',async()=>{
  for(const id of [3,4])await scoped(id,async()=>{
    assert.equal((await ensureRosterLoProfiles(q)).rows.length,1);
    assert.equal((await ensureRosterLoProfiles(q)).rows.length,0);
    const {rows}=await q("SELECT name,venue_id FROM people WHERE code='LO.Test'");
    assert.deepEqual(rows,[{name:'Shared Person',venue_id:1}]);
    assert.equal((await q('SELECT photo_path FROM attendance')).rows[0].photo_path,`r2:events/${id}/original.jpg`);
  });
});
