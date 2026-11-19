import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { rawPool, pool, q, migrate } from '../src/db.js';
import { eventContext, eventId, searchPathSql } from '../src/eventContext.js';
import { reportingDates } from '../src/reportingDays.js';
import { signAdmin, signChallenge, verifyChallenge, hashPassword } from '../src/auth.js';
import app from '../src/app.js';
import { invalidateEventMetadata } from '../src/events.js';
import { invalidateIdentityLinks } from '../src/loIdentity.js';
import { invalidateReportingRoster } from '../src/reporting.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Actual PostgreSQL in memory: never connect tests to DATABASE_URL.
const db = new PGlite();
let tail = Promise.resolve();
rawPool.connect = async () => {
  const previous = tail;
  let unlock;
  tail = new Promise((resolve) => { unlock = resolve; });
  await previous;
  return {
    async query(sql, params) {
      const result = params?.length ? await db.query(sql, params) : (await db.exec(sql)).at(-1);
      return { ...result, rowCount: result?.rows?.length || result?.affectedRows || 0 };
    },
    release: () => unlock(),
  };
};
rawPool.query = async (sql, params) => {
  const client = await rawPool.connect();
  try { return await client.query(sql, params); } finally { client.release(); }
};
const stages = {
  3: { id: 3, schema_name: 'public', name: 'BIMTEK Tahap 3', check_in_days: [{ date: '2026-11-11' }] },
  4: { id: 4, schema_name: 'bimtek_4', name: 'BIMTEK Tahap 4', check_in_days: [{ date: '2026-11-16' }] },
};
const scoped = (id, fn) => eventContext.run(stages[id], fn);
let server, origin, admin;
async function request(path, { method = 'GET', body, token = admin } = {}) {
  return fetch(`${origin}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined });
}
before(async () => {
  process.env.JWT_SECRET = 'test-event-isolation-secret-only';
  process.env.ADMIN_PASSWORD = 'test-admin-password';
  await migrate();
  await scoped(3, async () => {
    await q("INSERT INTO venues (name,lat,lng) VALUES ('Venue Tahap 3',-6,106)");
    await q("INSERT INTO people (code,name,role,position,venue_id,npsn) VALUES ('B-12345678','Peserta Tahap 3','peserta','Bendahara',1,'12345678')");
    await q("INSERT INTO sessions (name,role,starts_at,ends_at) VALUES ('Sesi Tahap 3','semua','2026-11-11T01:00:00Z','2026-11-11T09:00:00Z')");
    await q("INSERT INTO attendance (person_id,session_id,venue_id,photo_path,status) VALUES (1,1,1,'existing-photo.jpg','valid')");
    await q('INSERT INTO lo_accounts (name,username,password_hash,venue_id) VALUES ($1,$2,$3,1)', ['LO Tahap 3','lo-sama',hashPassword('test-lo-password')]);
    await q("INSERT INTO school_reporting (npsn,status) VALUES ('12345678','diterima')");
  });
  admin = signAdmin({ role: 'admin' });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  invalidateReportingRoster();
  invalidateEventMetadata();
  await rawPool.query("UPDATE public.bimtek_events SET status='archived'; UPDATE public.bimtek_events SET status='active' WHERE id=3; UPDATE public.bimtek_events SET status='draft' WHERE id=4");
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.close();
  await rawPool.end();
});

test('migration is repeatable and preserves participants, photos and attendance in Tahap 3', async () => {
  await migrate();
  assert.equal((await scoped(3, () => q('SELECT name FROM people'))).rows[0].name, 'Peserta Tahap 3');
  assert.equal((await scoped(3, () => q('SELECT photo_path FROM attendance'))).rows[0].photo_path, 'existing-photo.jpg');
  assert.equal((await scoped(4, () => q('SELECT * FROM people'))).rows.length, 0);
  assert.equal((await scoped(4, () => q('SELECT * FROM attendance'))).rows.length, 0);
});

test('same participant code and NPSN can be imported independently with no overwrite', async () => {
  const response = await request('/admin/people?event=4', { method: 'POST', body: { code: 'B-12345678', name: 'Peserta Tahap 4', role: 'peserta', position: 'Bendahara', npsn: '12345678' } });
  assert.equal(response.status, 200, await response.text());
  await scoped(4, () => q("INSERT INTO school_reporting (npsn,status) VALUES ('12345678','belum_kirim')"));
  for (const [id, name, status] of [[3,'Peserta Tahap 3','diterima'],[4,'Peserta Tahap 4','belum_kirim']]) {
    const data = await scoped(id, () => q('SELECT p.name,s.status FROM people p JOIN school_reporting s ON s.npsn=p.npsn'));
    assert.deepEqual(data.rows, [{ name, status }]);
  }
});

test('concurrent requests retain their own event and reporting dates', async () => {
  const result = await Promise.all(Array.from({ length: 16 }, (_, i) => scoped(i % 2 ? 3 : 4, async () => {
    const id = eventId();
    await new Promise((resolve) => setTimeout(resolve, i % 3));
    const { rows } = await q('SELECT name FROM people');
    return [id, rows[0].name, [...reportingDates]];
  })));
  for (const [id, name, dates] of result) {
    assert.equal(name, `Peserta Tahap ${id}`);
    assert.deepEqual(dates, [id === 3 ? '2026-11-11' : '2026-11-16']);
  }
});

test('explicit transactions and rollback are scoped to the selected event', async () => {
  await scoped(4, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE people SET name='Tidak boleh tersimpan'");
      assert.equal((await client.query('SELECT name FROM people')).rows[0].name, 'Tidak boleh tersimpan');
      await client.query('ROLLBACK');
      assert.equal((await client.query('SELECT name FROM people')).rows[0].name, 'Peserta Tahap 4');
    } finally { client.release(); }
  });
  assert.equal((await scoped(3, () => q('SELECT name FROM people'))).rows[0].name, 'Peserta Tahap 3');
});

test('missing event tables fail closed and never fall back to Tahap 3', async () => {
  await rawPool.query('CREATE SCHEMA bimtek_99');
  await assert.rejects(eventContext.run({ id: 99, schema_name: 'bimtek_99' }, () => q('SELECT * FROM people')), { code: '42P01' });
  assert.throws(() => searchPathSql({ schema_name: 'public; DROP TABLE people' }));
  assert.equal((await scoped(3, () => q('SELECT count(*)::int AS n FROM people'))).rows[0].n, 1);
});

test('venue, dashboard cache and empty attendance belong to the selected event', async () => {
  const third = await (await request('/info?event=3')).json();
  const fourth = await (await request('/info?event=4')).json();
  assert.equal(third.venues[0].name, 'Venue Tahap 3');
  assert.deepEqual(fourth.venues, []);
  assert.deepEqual(fourth.check_in_days, []);
  const a = await (await request('/dashboard/absensi?event=3')).json();
  const b = await (await request('/dashboard/absensi?event=4')).json();
  assert.equal(a.rows.length, 1);
  assert.deepEqual(b.rows, []);
});

test('LO token is resolved by username and challenge tokens stay event-bound', async () => {
  const token = await scoped(3, () => signAdmin({ role: 'lo', username: 'lo-sama', accounts: [{ event: 3, id: 1 }] }));
  assert.equal((await request('/admin/me?event=3', { token })).status, 200);
  assert.equal((await request('/admin/scan/participants?event=4', { token })).status, 403);
  const challenge = await scoped(3, () => signChallenge(1, 1, 'nonce'));
  assert.ok(await scoped(3, () => verifyChallenge(challenge)));
  assert.equal(await scoped(4, () => verifyChallenge(challenge)), null);
});

test('LO self attendance falls back to an open test session and prechecks its location', async () => {
  let venue, account, testSession, officialSession;
  const photoDir = await mkdtemp(join(tmpdir(), 'lo-self-photo-'));
  const photoPath = join(photoDir, 'self.jpg');
  const photoBytes = Buffer.from([255, 216, 255, 217]);
  await writeFile(photoPath, photoBytes);
  const previousUploadDir = process.env.UPLOAD_DIR;
  try {
    await scoped(3, async () => {
      venue = (await q("INSERT INTO venues (name,lat,lng,active) VALUES ('LO trial venue',-6,106,true) RETURNING id")).rows[0].id;
      account = (await q("INSERT INTO lo_accounts (name,username,password_hash,venue_id) VALUES ('LO Trial','lo-trial','unused',$1) RETURNING id", [venue])).rows[0].id;
      testSession = (await q("INSERT INTO sessions (name,role,starts_at,ends_at,venue_ids,is_test) VALUES ('Trial LO','panitia',now()-interval '1 hour',now()+interval '1 hour',$1,true) RETURNING id", [[venue]])).rows[0].id;
    });
    const token = await scoped(3, () => signAdmin({ role: 'lo', username: 'lo-trial', accounts: [{ event: 3, id: account }] }));
    const response = await request('/lo/challenge?event=3', { method: 'POST', token });
    assert.equal(response.status, 200, response.status === 200 ? '' : await response.text());
    const challenge = await response.json();
    assert.equal(challenge.session.is_test, true);
    assert.equal((await scoped(3, () => verifyChallenge(challenge.token))).s, testSession);
    const precheck = await request('/lo/precheck?event=3', { method: 'POST', token, body: { token: challenge.token, lat: -6, lng: 106, accuracy: 5 } });
    assert.equal(precheck.status, 200, await precheck.text());
    officialSession = await scoped(3, async () => (await q("INSERT INTO sessions (name,role,starts_at,ends_at,venue_ids,is_test) VALUES ('Official LO','panitia',now()-interval '30 minutes',now()+interval '1 hour',$1,false) RETURNING id", [[venue]])).rows[0].id);
    const official = await (await request('/lo/challenge?event=3', { method: 'POST', token })).json();
    assert.equal(official.session.is_test, false);
    assert.equal((await scoped(3, () => verifyChallenge(official.token))).s, officialSession);
    const empty = await (await request('/lo/attendance?event=3', { token })).json();
    assert.deepEqual(empty.records, []);
    assert.equal(empty.recorded, false);
    let attendance;
    await scoped(3, async () => {
      const person = (await q("SELECT id FROM people WHERE code='lo-trial'")).rows[0];
      attendance = (await q("INSERT INTO attendance(person_id,session_id,venue_id,photo_path,status) VALUES($1,$2,$3,$4,'valid') RETURNING id", [person.id,officialSession,venue,photoPath])).rows[0].id;
    });
    const saved = await (await request('/lo/attendance?event=3', { token })).json();
    assert.equal(saved.recorded, true);
    assert.equal(saved.records.length, 1);
    assert.equal(saved.records[0].name, 'LO Trial');
    assert.equal(saved.records[0].has_photo, true);
    assert.equal(saved.records[0].is_test, false);
    assert.equal(saved.records[0].photo_path, undefined);
    const photo = await request(`/lo/attendance/${attendance}/photo?event=3&t=${encodeURIComponent(token)}`, { token: null });
    assert.equal(photo.status, 200);
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), photoBytes);
    assert.equal((await request('/lo/attendance/1/photo?event=3', { token })).status, 404);
    assert.equal((await request(`/lo/attendance/${attendance}/photo?event=3`, { token: null })).status, 401);
    assert.equal((await request('/lo/attendance?event=4', { token })).status, 403);
    assert.equal((await request('/lo/challenge?event=3', { method: 'POST', token })).status, 409);
    await scoped(3, () => q("UPDATE attendance SET status='ditolak' WHERE id=$1", [attendance]));
    const rejected = await (await request('/lo/attendance?event=3', { token })).json();
    assert.equal(rejected.recorded, false);
    assert.equal(rejected.retry, true);
    const retryResponse = await request('/lo/challenge?event=3', { method: 'POST', token });
    assert.equal(retryResponse.status, 200);
    const retryChallenge = await retryResponse.json();
    const invalid = await request('/lo/attendance?event=3', { method: 'POST', token, body: { token: retryChallenge.token, photo: 'invalid' } });
    assert.equal(invalid.status, 400);
    assert.equal((await (await request('/lo/attendance?event=3', { token })).json()).records[0].status, 'ditolak');
    process.env.UPLOAD_DIR = photoDir;
    const newPhoto = Buffer.alloc(4500, 1); newPhoto[0] = 255; newPhoto[1] = 216;
    const retryBody = { token: retryChallenge.token, photo: `data:image/jpeg;base64,${newPhoto.toString('base64')}`,
      samples: [{ lat: -6.000001, lng: 106.000001, accuracy: 5, altitude: 10, at: Date.now(), ts: Date.now() }] };
    const submissions = await Promise.all([1,2].map(() => request('/lo/attendance?event=3', { method: 'POST', token, body: retryBody })));
    assert.deepEqual(submissions.map((r) => r.status).sort(), [200,409]);
    const updated = await (await request('/lo/attendance?event=3', { token })).json();
    assert.equal(updated.records.length, 1);
    assert.equal(updated.records[0].id, attendance);
    assert.notEqual(updated.records[0].status, 'ditolak');
    assert.equal(updated.recorded, true);
    assert.equal(updated.retry, false);
    assert.equal(updated.records[0].photo_history.length, 1);
    assert.equal(updated.records[0].photo_history[0].status, 'ditolak');
    assert.equal(updated.records[0].photo_history[0].photo_path, undefined);
    const oldPhoto = await request(`/lo/attendance/${attendance}/photo?event=3&version=0`, { token });
    assert.equal(oldPhoto.status,200);
    assert.deepEqual(Buffer.from(await oldPhoto.arrayBuffer()),photoBytes);
    assert.equal((await request(`/lo/attendance/${attendance}/photo?event=3&version=9`, { token })).status,404);
    assert.equal((await request('/lo/attendance/1/photo?event=3&version=0', { token })).status,404);
    const adminHistory = await request(`/admin/photo/${attendance}?event=3&version=0&bytes=true`);
    assert.equal(adminHistory.status,200);
    assert.deepEqual(Buffer.from(await adminHistory.arrayBuffer()),photoBytes);
    assert.equal((await request('/lo/challenge?event=3', { method: 'POST', token })).status, 409);
  } finally {
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousUploadDir;
    await scoped(3, async () => {
      await q('DELETE FROM attendance WHERE session_id=ANY($1::int[])', [[testSession, officialSession].filter(Boolean)]);
      await q('DELETE FROM sessions WHERE id=ANY($1::int[])', [[testSession, officialSession].filter(Boolean)]);
      if (account) await q('DELETE FROM lo_accounts WHERE id=$1', [account]);
      await q("DELETE FROM people WHERE code='lo-trial'");
      if (venue) await q('DELETE FROM venues WHERE id=$1', [venue]);
    });
    await rm(photoDir, { recursive: true, force: true });
  }
});

test('activation archives the previous event, blocks changes and retains readable exports', async () => {
  const activated = await request('/events/4/status', { method: 'PUT', body: { status: 'active' } });
  assert.equal(activated.status, 200, await activated.text());
  const list = await (await request('/events')).json();
  assert.equal(list.find((event) => event.id === 3).status, 'archived');
  assert.equal(list.find((event) => event.id === 4).status, 'active');
  assert.equal((await (await request('/info')).json()).event.id, 4);
  assert.equal((await request('/admin/people?event=3', { method: 'POST', body: { code: 'new', name: 'Blocked', role: 'peserta' } })).status, 409);
  assert.equal((await request('/admin/people?event=3')).status, 200);
  const csv = await request('/admin/export?event=3&session_id=1');
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /\/admin\/absensi\/foto\/1\?event=3/);
  const login = await request('/admin/login?event=3', { method: 'POST', body: { username: 'lo-sama', password: 'test-lo-password' }, token: null });
  assert.equal(login.status, 200);
});

test('only main admin can activate events and invalid event IDs are rejected', async () => {
  const lo = await scoped(3, () => signAdmin({ role: 'lo', username: 'lo-sama', accounts: [{ event: 3, id: 1 }] }));
  assert.equal((await request('/events/4/status', { method: 'PUT', body: { status: 'active' }, token: lo })).status, 403);
  assert.equal((await request('/events/4/status', { method: 'PUT', body: { status: 'active' }, token: null })).status, 401);
  assert.equal((await request('/info?event=999')).status, 404);
  assert.equal((await request('/info?event=3&event=4')).status, 400);
});

test('official session dates are derived independently for Tahap 4', async () => {
  const result = await request('/admin/sessions?event=4', { method: 'POST', body: {
    name: 'Sesi Tahap 4', role: 'semua', type: 'masuk', starts_at: '2026-11-16T01:00:00Z', ends_at: '2026-11-16T09:00:00Z', is_test: false,
  } });
  assert.equal(result.status, 200, await result.text());
  const info = await (await request('/info?event=4')).json();
  assert.deepEqual(info.check_in_days.map((day) => day.date), ['2026-11-16']);
  assert.equal((await (await request('/info?event=3')).json()).check_in_days[0].date, '2026-11-11');
});

test('legacy QR links resolve the original event after switching the active event', async () => {
  const { rows: [person] } = await scoped(3, () => q('SELECT qr_token FROM people WHERE id=1'));
  await request('/events/4/status', { method: 'PUT', body: { status: 'active' } });
  const result = await request(`/events/resolve-qr/${person.qr_token}`, { token: null });
  assert.equal((await result.json()).id, 3);
  const card = await (await request(`/qr/${person.qr_token}?event=3`, { token: null })).json();
  assert.equal(card.name, 'Peserta Tahap 3');
});

test('Tahap 2 reporting archive remains available when Tahap 4 is selected', async () => {
  const response = await request('/dashboard/pelaporan?event=4&period=k3');
  assert.equal(response.status, 200);
  const archive = await response.json();
  assert.ok(archive.schools.length > 0);
  const third = await (await request('/dashboard/pelaporan?event=3&period=k3')).json();
  assert.equal(archive.schools.length, third.schools.length);
  assert.equal(archive.title, third.title);
});

test('LO login succeeds independently of the selected or active event', async () => {
  await request('/events/4/status', { method: 'PUT', body: { status: 'active' } });
  for (const path of ['/admin/login?event=4', '/admin/login', '/admin/login?event=999']) {
    const response = await request(path, { method: 'POST', token: null,
      body: { username: 'LO-SAMA', password: 'test-lo-password' } });
    assert.equal(response.status, 200);
    const login = await response.json();
    assert.equal(login.event.id, 3);
    assert.deepEqual(login.user.events.map((event) => event.id), [3,4]);
    assert.equal((await request('/admin/me?event=3', { token: login.token })).status, 200);
    assert.equal((await request('/admin/scan/participants?event=4', { token: login.token })).status, 403);
  }
});

test('one LO session switches assigned events while keeping each venue scoped', async () => {
  for (const id of [3, 4]) await scoped(id, async () => {
    const { rows: [venue] } = await q('INSERT INTO venues (name,lat,lng) VALUES ($1,-6,106) RETURNING id', [`Login venue ${id}`]);
    await q('INSERT INTO lo_accounts (name,username,password_hash,venue_id) VALUES ($1,$2,$3,$4)',
      ['Shared LO', 'lo-shared-login', hashPassword('shared-test-password'), venue.id]);
  });
  const response = await request('/admin/login?event=4', { method: 'POST', token: null,
    body: { username: 'lo-shared-login', password: 'shared-test-password' } });
  assert.equal(response.status, 200);
  const login = await response.json();
  assert.equal(login.event.id, 3); // Active stage wins over a saved selection.
  assert.deepEqual(login.user.events.map((event) => event.id), [3, 4]);
  for (const id of [3, 4]) {
    const me = await request(`/admin/me?event=${id}`, { token: login.token });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).venue.name, `Login venue ${id}`);
  }
  await scoped(4, () => q("UPDATE lo_accounts SET active=false WHERE username='lo-shared-login'"));
  assert.equal((await request('/admin/me?event=4', { token: login.token })).status, 401);
  assert.equal((await request('/admin/me?event=3', { token: login.token })).status, 200);
});

test('a same-username account with different credentials does not gain access', async () => {
  await scoped(4, () => q('INSERT INTO lo_accounts (name,username,password_hash,venue_id) VALUES ($1,$2,$3,(SELECT id FROM venues LIMIT 1))',
    ['Different account', 'lo-sama', hashPassword('different-test-password')]));
  const response = await request('/admin/login?event=4', { method: 'POST', token: null,
    body: { username: 'lo-sama', password: 'test-lo-password' } });
  assert.equal(response.status, 200);
  const login = await response.json();
  assert.equal(login.event.id, 3);
  assert.equal((await request('/admin/scan/participants?event=4', { token: login.token })).status, 403);
  const bad = await request('/admin/login?event=3', { method: 'POST', token: null,
    body: { username: 'lo-sama', password: 'wrong-password' } });
  assert.equal(bad.status, 401);
});

test('warm metadata requests reuse the event list and do not query unrelated session dates', async () => {
  const original = rawPool.query; let reads = 0;
  rawPool.query = (...args) => { reads++; return original(...args); };
  try {
    assert.equal((await request('/admin/me?event=4')).status, 200);
    const first = reads;
    assert.equal((await request('/admin/me?event=4')).status, 200);
    assert.equal(reads, first);
    assert.equal(first, 1);
  } finally { rawPool.query = original; }
});

test('scan candidate pruning preserves owner mapping and excludes unknown owners', async () => {
  let prior;
  try {
    await scoped(3, async()=>{
      prior=(await q('SELECT data FROM assignment_roster WHERE id=1')).rows[0];
      const data={schools:[],attendance_assignments:{'1':[{code:'B-12345678',name:'Peserta Tahap 3',position:'Bendahara',npsn:'12345678',venue_id:1}]}};
      await q('INSERT INTO assignment_roster(id,data) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',[JSON.stringify(data)]);
    });
    const token=signAdmin({role:'lo',username:'lo-sama',accounts:[{event:3,id:1}]});
    const response=await request('/admin/scan/participants?event=3&category=sekolah&lo_id=1',{token});
    assert.equal(response.status,200,await response.clone().text());
    const data=await response.json();assert.equal(data.rows.length,1);assert.equal(data.rows[0].name,'Peserta Tahap 3');assert.equal(data.rows[0].can_check_in,true);
    const defaultResponse=await request('/admin/scan/participants?event=3&category=sekolah',{token});
    assert.equal(defaultResponse.status,200);
    assert.deepEqual((await defaultResponse.json()).rows.map(row=>row.id),data.rows.map(row=>row.id));
    const empty=await request('/admin/scan/participants?event=3&category=sekolah&lo_id=999999',{token});
    assert.equal(empty.status,200);assert.equal((await empty.json()).rows.length,0);
  }finally{
    await scoped(3,()=>prior?q('UPDATE assignment_roster SET data=$1 WHERE id=1',[JSON.stringify(prior.data)]):q('DELETE FROM assignment_roster WHERE id=1'));
  }
});

test('facilitator directory includes reports for their assigned schools at the same venue', async () => {
  let prior,person;
  try {
    await scoped(3,async()=>{
      prior=(await q('SELECT data FROM assignment_roster WHERE id=1')).rows[0];
      const data={lo:[],attendance_assignments:{},schools:[
        {npsn:'12345678',name:'Kirim',venue:'Venue Tahap 3',facilitator:'Fasil Uji'},
        {npsn:'87654321',name:'Belum',venue:'Venue Tahap 3',facilitator:'Fasil Uji'},
        {npsn:'99999999',name:'Lain venue',venue:'Venue lain',facilitator:'Fasil Uji'},
      ]};
      await q('INSERT INTO assignment_roster(id,data) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',[JSON.stringify(data)]);
      person=(await q("INSERT INTO people(code,name,role,position,venue_id) VALUES('fasil-report-test','Fasil Uji','peserta','Fasilitator Pelaporan',1) RETURNING id")).rows[0].id;
    });
    const response=await request('/admin/scan/participants?event=3&category=fasil&q=Fasil%20Uji');
    assert.equal(response.status,200,await response.clone().text());
    const data=await response.json();assert.equal(data.rows.length,1);
    const reports=data.rows[0].school_reports;
    assert.equal(reports.length,2);
    assert.equal(reports.filter(r=>['menunggu_reviu','ditolak','diterima','sudah_direviu'].includes(r.status)).length,1);
    assert(!reports.some(r=>r.npsn==='99999999'));
  }finally{
    await scoped(3,async()=>{
      if(person)await q('DELETE FROM people WHERE id=$1',[person]);
      if(prior)await q('UPDATE assignment_roster SET data=$1 WHERE id=1',[JSON.stringify(prior.data)]);
      else await q('DELETE FROM assignment_roster WHERE id=1');
    });
  }
});

test('attendance sorting applies before pagination and rejects unsupported orders', async () => {
  let session, people = [], venues = [];
  try {
    await scoped(3, async () => {
      venues = (await q("INSERT INTO venues(name,lat,lng) VALUES('Sort Z',-6,106),('Sort A',-6,106) RETURNING id")).rows.map(v => v.id);
      people = (await q("INSERT INTO people(code,name,role,venue_id) VALUES('sort-a','A Sort','peserta',$1),('sort-b','B Sort','peserta',$2) RETURNING id", venues)).rows.map(p => p.id);
      await q("UPDATE people SET npsn=CASE WHEN id=$1 THEN '00123456' ELSE '00987654' END WHERE id=ANY($2::int[])",[people[0],people]);
      session = (await q("INSERT INTO sessions(name,role,starts_at,ends_at) VALUES('Sorting test','semua',now(),now()+interval '1 hour') RETURNING id")).rows[0].id;
      await q("INSERT INTO attendance(person_id,session_id,venue_id,status,risk_score,created_at) VALUES($1,$3,$4,'valid',0,now()),($2,$3,$5,'valid',5,now()-interval '1 hour')", [...people,session,...venues]);
    });
    for (const [sort, expected] of Object.entries({risk:'B Sort',newest:'A Sort',oldest:'B Sort',name_asc:'A Sort',name_desc:'B Sort',venue_asc:'B Sort',venue_desc:'A Sort'})) {
      const response = await request(`/admin/attendance?event=3&session_id=${session}&sort=${sort}&limit=1`);
      assert.equal(response.status,200);
      const data = await response.json(); assert.equal(data.total,2); assert.equal(data.rows[0].name,expected);
      const next = await (await request(`/admin/attendance?event=3&session_id=${session}&sort=${sort}&limit=1&offset=1`)).json();
      assert.equal(next.rows.length,1); assert.notEqual(next.rows[0].name,expected);
    }
    assert.equal((await request(`/admin/attendance?event=3&session_id=${session}&sort=invalid`)).status,400);
    for(const term of ['a sort','00123456']) {
      const result=await request(`/admin/attendance?event=3&session_id=${session}&q=${encodeURIComponent(term)}&limit=1`);
      assert.equal(result.status,200,await result.clone().text());
      const data=await result.json();assert.equal(data.total,1);assert.equal(data.counts.total,1);assert.equal(data.rows[0].name,'A Sort');
      const csv=await (await request(`/admin/export?event=3&session_id=${session}&q=${encodeURIComponent(term)}`)).text();
      assert.ok(csv.includes('A Sort'));assert.ok(!csv.includes('B Sort'));
    }
    const none=await (await request(`/admin/attendance?event=3&session_id=${session}&q=%25`)).json();assert.equal(none.total,0);
    const outside=await (await request(`/admin/attendance?event=4&session_id=1&q=00123456`)).json();assert.ok(!outside.rows?.some(row=>row.name==='A Sort'));
    assert.equal((await request(`/admin/attendance?event=3&session_id=${session}&q[]=bad`)).status,400);
  } finally {
    await scoped(3,async()=>{
      if(session){await q('DELETE FROM attendance WHERE session_id=$1',[session]);await q('DELETE FROM sessions WHERE id=$1',[session]);}
      await q('DELETE FROM people WHERE id=ANY($1::int[])',[people]);
      await q('DELETE FROM venues WHERE id=ANY($1::int[])',[venues]);
    });
  }
});

test('reporting defaults a missing dataset to the selected event for admin and LO', async () => {
  const loToken = signAdmin({ role: 'lo', username: 'lo-sama', accounts: [{ event: 3, id: 1 }] });
  for (const token of [admin, loToken]) {
    for (const suffix of ['', '&dataset=']) {
      const response = await request(`/admin/reporting?event=3${suffix}`, { token });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal((await response.json()).title, 'BIMTEK Tahap 3');
    }
    assert.equal((await request('/admin/reporting?event=3&dataset=unknown', { token })).status, 400);
  }
  const fourth = await request('/admin/reporting?event=4');
  assert.equal(fourth.status, 200);
  assert.equal((await fourth.json()).title, 'BIMTEK Tahap 4');
});

test('aggregated reporting preserves dates, arrival status and event isolation', async () => {
  await scoped(3, async () => {
    const data = { lo: [{name:'LO Tahap 3',venue:'Venue Tahap 3',account_id:1,venue_id:1}], facilitators: [],
      schools: [{npsn:'12345678',name:'Sekolah Tahap 3',venue:'Venue Tahap 3',lo:'LO Tahap 3'}] };
    await q('INSERT INTO assignment_roster(id,data) VALUES (1,$1) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data', [JSON.stringify(data)]);
    await q(`INSERT INTO venue_arrival_recap(venue_id,marks) VALUES (1,'{"1":"sedang_antre"}') ON CONFLICT(venue_id) DO UPDATE SET marks=EXCLUDED.marks`);
  });
  const response = await request('/admin/reporting?dataset=current&event=3');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.schools[0].status, 'diterima');
  assert.deepEqual(data.schools[0].check_in_dates, ['2026-11-11']);
  assert.equal(data.schools[0].attendance, 'sudah_absen');
  assert.equal(data.schools[0].venue_attendance, 'sedang_antre');
  const fourth = await (await request('/admin/reporting?dataset=current&event=4')).json();
  assert.deepEqual(fourth.schools, []);
});

test('photo byte export requires authentication and preserves venue authorization', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'bimtek-photo-test-'));
  const file = join(folder, 'photo.jpg'); const bytes = Buffer.from([255,216,255,217]);
  await writeFile(file, bytes);
  try {
    await scoped(3, () => q('UPDATE attendance SET photo_path=$1 WHERE id=1', [file]));
    assert.equal((await request('/admin/photo/1?event=3&bytes=true', {token:null})).status, 401);
    const response = await request('/admin/photo/1?event=3&bytes=true');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    await scoped(3, () => q('UPDATE attendance SET venue_id=(SELECT id FROM venues WHERE id<>1 LIMIT 1) WHERE id=1'));
    const token = signAdmin({role:'lo',username:'lo-sama',accounts:[{event:3,id:1}]});
    assert.equal((await request('/admin/photo/1?event=3&bytes=true', {token})).status, 403);
  } finally {
    await scoped(3, () => q("UPDATE attendance SET photo_path='existing-photo.jpg',venue_id=1 WHERE id=1"));
    await rm(folder, {recursive:true,force:true});
  }
});

test('recaps only list roster venues and keep inactive venues that belong to the archived activity', async () => {
  await scoped(3, async () => {
    await q("UPDATE assignment_roster SET data=jsonb_set(data,'{venues}','[\"Venue Tahap 3\"]') WHERE id=1");
    await q("UPDATE venues SET active=false WHERE id=1");
    await q(`UPDATE venue_arrival_recap SET detail_rows='[{"id":1,"name":"Peserta Tahap 3","position":"Bendahara","institution":"Sekolah Contoh","arrival_status":"sedang_antre"}]',source_summary=NULL WHERE venue_id=1`);
    await q("INSERT INTO venues(name,lat,lng,active) VALUES ('Claro from another activity',-6,106,false),('Unmapped venue',-6,106,true)");
  });
  await scoped(4, async () => {
    const data = {venues:['Login venue 4'],lo:[],schools:[],facilitators:[]};
    await q('INSERT INTO assignment_roster(id,data) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data', [JSON.stringify(data)]);
  });
  for (const path of ['/admin/arrival-recap?event=3','/admin/venue-attendance?event=3']) {
    const response = await request(path);
    assert.equal(response.status, 200);
    const rows = await response.json();
    assert.deepEqual(rows.map((row) => row.name), ['Venue Tahap 3']);
    if (path.includes('arrival-recap')) assert.equal(rows[0].queued, 1);
  }
  const fourth = await (await request('/admin/arrival-recap?event=4')).json();
  assert.deepEqual(fourth.map((row) => row.name), ['Login venue 4']);
  assert.equal(fourth[0].source_ready, false);
});

test('attendance distinguishes an invalid activity/session combination from an empty valid session', async () => {
  const invalid = await request('/admin/attendance?event=4&session_id=999');
  assert.equal(invalid.status, 404);
  assert.match((await invalid.json()).error, /kegiatan ini/);
  assert.equal((await request('/admin/attendance?event=4&session_id=wrong')).status, 400);
  const valid = await request('/admin/attendance?event=4&session_id=1');
  assert.equal(valid.status, 200);
  const data = await valid.json();
  assert.equal(data.total, 0);
  assert.deepEqual(data.rows, []);
});

test('verification and arrival recap APIs are restricted to the main admin', async () => {
  const token = signAdmin({role:'lo',username:'lo-sama',accounts:[{event:3,id:1}]});
  for (const path of ['/admin/arrival-recap?event=3','/admin/arrival-recap/1/participants?event=3&group=invited',
    '/admin/attempts?event=3&session_id=1']) {
    const denied = await request(path, {token});
    assert.equal(denied.status, 403);
    assert.equal((await request(path)).status, 200);
  }
  assert.equal((await request('/admin/attendance/1?event=3', {method:'PATCH',token,body:{status:'ditolak'}})).status, 409);
  assert.equal((await request('/admin/venue-attendance?event=3', {token})).status, 200);
});

test('LO can edit notes, reject and delete only their own participant records',async()=>{
  let session,people=[],ownId;
  const token=signAdmin({role:'lo',username:'lo-sama',accounts:[{event:3,id:1}]});
  try{
    await scoped(3,async()=>{
      session=(await q("INSERT INTO sessions(name,role,starts_at,ends_at) VALUES('Own verification','semua',now(),now()+interval '1 hour') RETURNING id")).rows[0].id;
      people=(await q("INSERT INTO people(code,name,role,position,venue_id) VALUES('own-v1','Own recorded','peserta','Bendahara',1),('own-v2','Other recorder','peserta','Bendahara',1),('own-v3','Self checkin','peserta','Bendahara',1) RETURNING id")).rows.map(p=>p.id);
      await q("INSERT INTO attendance(person_id,session_id,venue_id,status,method,scanned_by,ip) VALUES($1,$4,1,'valid','manual','LO LO Tahap 3','127.0.0.1'),($2,$4,1,'review','manual','LO Other','127.0.0.1'),($3,$4,1,'valid','selfie','LO LO Tahap 3','127.0.0.1')",[...people,session]);
      await q('UPDATE people SET npsn=$1 WHERE id=ANY($2::int[])',['00112233',people]);
    });
    for(const suffix of ['', '&recorded_by=LO%20Other&venue_id=999']){
      const response=await request(`/admin/attendance?event=3&session_id=${session}${suffix}`,{token});
      assert.equal(response.status,200,await response.clone().text());const data=await response.json();
      assert.equal(data.total,1);assert.equal(data.counts.total,1);assert.equal(data.rows[0].name,'Own recorded');
      assert.deepEqual(data.recorders,[]);assert.equal(data.rows[0].can_verify,true);assert.equal(data.rows[0].can_delete,true);assert.equal(data.rows[0].can_edit_note,true);assert.ok(!('ip' in data.rows[0]));
      ownId=data.rows[0].id;
    }
    for(const [term,expected] of [['OWN REC',1],['00112233',1],['Other recorder',0],['Self checkin',0],['tidak-ditemukan',0]]) {
      const response=await request(`/admin/attendance?event=3&session_id=${session}&q=${encodeURIComponent(term)}`,{token});
      assert.equal(response.status,200);const data=await response.json();
      assert.equal(data.total,expected);assert.equal(data.counts.total,expected);assert.equal(data.rows.length,expected);
      if(expected)assert.equal(data.rows[0].id,ownId);
    }
    const all=await (await request(`/admin/attendance?event=3&session_id=${session}`)).json();assert.equal(all.total,3);
    for(const row of all.rows.filter(row=>row.id!==ownId)) {
      assert.equal((await request(`/admin/attendance/${row.id}/note?event=3`,{method:'PATCH',token,body:{note:'Not allowed'}})).status,404);
      assert.equal((await request(`/admin/attendance/${row.id}?event=3`,{method:'PATCH',token,body:{status:'ditolak'}})).status,409);
      assert.equal((await request(`/admin/attendance/${row.id}?event=3`,{method:'DELETE',token,body:{confirmation:'saya ingin menghapus absen ini'}})).status,404);
    }
    assert.equal((await request(`/admin/attendance/${ownId}/note?event=3`,{method:'PATCH',token,body:{note:'Catatan diperbarui'}})).status,200);
    assert.equal((await request(`/admin/attendance/${ownId}?event=3`,{method:'PATCH',token,body:{status:'valid'}})).status,403);
    assert.equal((await request(`/admin/attendance/${ownId}?event=3`,{method:'PATCH',token,body:{status:'ditolak'}})).status,200);
    assert.equal((await request(`/admin/attendance/${ownId}?event=3`,{method:'DELETE',token,body:{confirmation:'salah'}})).status,400);
    assert.equal((await request(`/admin/attendance/${ownId}?event=3`,{method:'DELETE',token,body:{confirmation:'saya ingin menghapus absen ini'}})).status,204);
  }finally{await scoped(3,async()=>{if(session){await q('DELETE FROM attendance WHERE session_id=$1',[session]);await q('DELETE FROM sessions WHERE id=$1',[session]);}await q('DELETE FROM people WHERE id=ANY($1::int[])',[people]);});}
});

test('unavailable attendance requires a reason, preserves it in lists and exports, and restricts edits to the recorder', async () => {
  let session,person,prior;
  const token=signAdmin({role:'lo',username:'lo-sama',accounts:[{event:3,id:1}]});
  try {
    await scoped(3,async()=>{
      prior=(await q('SELECT data FROM assignment_roster WHERE id=1')).rows[0];
      person=(await q("INSERT INTO people(code,name,role,position,venue_id,npsn) VALUES('reason-test','Peserta Alasan','peserta','Bendahara',1,'90909090') RETURNING id")).rows[0].id;
      const roster={schools:[],attendance_assignments:{'1':[{code:'reason-test',name:'Peserta Alasan',position:'Bendahara',npsn:'90909090',venue_id:1}]}};
      await q('INSERT INTO assignment_roster(id,data) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',[JSON.stringify(roster)]);
      session=(await q("INSERT INTO sessions(name,role,starts_at,ends_at,is_test) VALUES('Reason test','peserta',now()-interval '1 hour',now()+interval '1 hour',true) RETURNING id")).rows[0].id;
    });
    const body={code:'reason-test',session_id:session,unavailable:true};
    for(const note of [undefined,'  ','x'.repeat(1001),42])assert.equal((await request('/admin/scan?event=3',{method:'POST',token,body:{...body,note}})).status,400);
    const response=await request('/admin/scan?event=3',{method:'POST',token,body:{...body,note:'  Sakit, perlu istirahat  '}});
    assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).status,'berhalangan');
    const list=await (await request(`/admin/attendance?event=3&session_id=${session}`,{token})).json();
    assert.equal(list.rows.length,1);const record=list.rows[0];assert.equal(record.participant_note,'Sakit, perlu istirahat');assert.equal(record.can_edit_note,true);assert.equal(record.has_photo,false);
    const scan=await (await request(`/admin/scan/participants?event=3&category=sekolah&session_id=${session}`,{token})).json();
    const row=scan.rows.find(p=>p.id===person);assert.equal(row.unavailable,true);assert.equal(row.attended,null);assert.equal(row.unavailable_record.participant_note,'Sakit, perlu istirahat');
    assert.equal((await request(`/admin/attendance/${record.id}/note?event=3`,{method:'PATCH',token,body:{note:'Keperluan keluarga'}})).status,200);
    const exported=await (await request(`/admin/export?event=3&session_id=${session}&recorded_only=true`)).text();assert.ok(exported.includes('Keperluan keluarga'));assert.ok(exported.includes('Alasan berhalangan'));
    await scoped(3,()=>q("UPDATE attendance SET scanned_by='LO Orang lain' WHERE id=$1",[record.id]));
    assert.equal((await request(`/admin/attendance/${record.id}/note?event=3`,{method:'PATCH',token,body:{note:'Tidak boleh'}})).status,404);
  } finally {
    await scoped(3,async()=>{
      if(session){await q('DELETE FROM attendance WHERE session_id=$1',[session]);await q('DELETE FROM sessions WHERE id=$1',[session]);}
      if(person)await q('DELETE FROM people WHERE id=$1',[person]);
      await (prior?q('UPDATE assignment_roster SET data=$1 WHERE id=1',[JSON.stringify(prior.data)]):q('DELETE FROM assignment_roster WHERE id=1'));
    });
  }
});

test('LO retries rejected attendance with a fresh photo once, preserving the previous record and enforcing session/assignment', async () => {
  let prior,session,person,attendance;
  const photoDir=await mkdtemp(join(tmpdir(),'lo-participant-retry-'));
  const previousUploadDir=process.env.UPLOAD_DIR;
  const token=signAdmin({role:'lo',username:'lo-sama',accounts:[{event:3,id:1}]});
  try {
    process.env.UPLOAD_DIR=photoDir;
    const oldPhoto=join(photoDir,'old.jpg');await writeFile(oldPhoto,Buffer.from([255,216,255,217]));
    await scoped(3,async()=>{
      prior=(await q('SELECT data FROM assignment_roster WHERE id=1')).rows[0];
      person=(await q("INSERT INTO people(code,name,role,position,venue_id,npsn) VALUES('retry-participant','Peserta Ulang','peserta','Pengawas',1,'91919191') RETURNING id")).rows[0].id;
      const data={schools:[],attendance_assignments:{'1':[{code:'retry-participant',name:'Peserta Ulang',position:'Pengawas',npsn:'91919191',venue_id:1}]}};
      await q('INSERT INTO assignment_roster(id,data) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',[JSON.stringify(data)]);
      session=(await q("INSERT INTO sessions(name,role,starts_at,ends_at,is_test) VALUES('Retry participant','peserta',now()-interval '1 hour',now()+interval '1 hour',true) RETURNING id")).rows[0].id;
      attendance=(await q("INSERT INTO attendance(person_id,session_id,venue_id,status,method,scanned_by,photo_path,participant_note,lat,lng,risk_score) VALUES($1,$2,1,'ditolak','manual','LO LO Tahap 3',$3,'Catatan lama',-6,106,20) RETURNING id",[person,session,oldPhoto])).rows[0].id;
    });
    const bytes=Buffer.alloc(4500,1);bytes[0]=255;bytes[1]=216;
    const body={code:'retry-participant',session_id:session,note:'Foto dan catatan baru',photo:`data:image/jpeg;base64,${bytes.toString('base64')}`};
    assert.equal((await request('/admin/scan?event=3',{method:'POST',token,body:{...body,photo:'invalid'}})).status,400);
    await scoped(3,()=>q("UPDATE sessions SET ends_at=now()-interval '1 minute' WHERE id=$1",[session]));
    assert.equal((await request('/admin/scan?event=3',{method:'POST',token,body})).status,400);
    await scoped(3,()=>q("UPDATE sessions SET ends_at=now()+interval '1 hour' WHERE id=$1",[session]));
    assert.equal((await request('/admin/scan?event=3',{method:'POST',token,body:{...body,code:'B-12345678'}})).status,403);
    const results=await Promise.all([1,2].map(()=>request('/admin/scan?event=3',{method:'POST',token,body})));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const {rows:saved}=await scoped(3,()=>q('SELECT * FROM attendance WHERE person_id=$1 AND session_id=$2',[person,session]));
    assert.equal(saved.length,1);const row=saved[0];assert.equal(row.id,attendance);assert.equal(row.status,'valid');
    assert.equal(row.participant_note,'Foto dan catatan baru');assert.notEqual(row.photo_path,oldPhoto);
    assert.equal(row.photo_history.length,1);assert.equal(row.photo_history[0].status,'ditolak');assert.equal(row.photo_history[0].photo_path,oldPhoto);assert.equal(row.photo_history[0].participant_note,'Catatan lama');
    assert.equal(row.lat,null);assert.equal(row.lng,null);assert.equal(row.risk_score,0);
    assert.equal((await request(`/admin/photo/${attendance}?event=3&version=0&bytes=true`)).status,200);
    assert.equal((await request('/admin/scan?event=3',{method:'POST',token,body})).status,409);
  } finally {
    if(previousUploadDir==null)delete process.env.UPLOAD_DIR;else process.env.UPLOAD_DIR=previousUploadDir;
    await scoped(3,async()=>{
      if(session){await q('DELETE FROM attendance WHERE session_id=$1',[session]);await q('DELETE FROM sessions WHERE id=$1',[session]);}
      if(person)await q('DELETE FROM people WHERE id=$1',[person]);
      await(prior?q('UPDATE assignment_roster SET data=$1 WHERE id=1',[JSON.stringify(prior.data)]):q('DELETE FROM assignment_roster WHERE id=1'));
    });
    await rm(photoDir,{recursive:true,force:true});
  }
});

test('venue recaps and details use arrival invitations, retain unknown source participants and exclude extra profiles', async()=>{
  let prior,priorRoster,session;let people=[];
  try {
    await scoped(3,async()=>{
      prior=(await q('SELECT * FROM venue_arrival_recap WHERE venue_id=1')).rows[0];
      priorRoster=(await q('SELECT data FROM assignment_roster WHERE id=1')).rows[0];
      await q("INSERT INTO assignment_roster(id,data) VALUES(1,'{\"venues\":[\"Venue Tahap 3\"],\"lo\":[],\"schools\":[],\"facilitators\":[]}') ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data");
      people=(await q("INSERT INTO people(code,name,role,position,venue_id,institution) VALUES('source-known','Sumber dikenal','peserta','Pengawas',1,'Sekolah Dikenal'),('source-extra','Profil tambahan','peserta','Pengawas',1,'Sekolah Lain') RETURNING id")).rows.map(p=>p.id);
      session=(await q("INSERT INTO sessions(name,role,starts_at,ends_at,is_test) VALUES('Source population test','peserta',now()-interval '1 hour',now()+interval '1 hour',true) RETURNING id")).rows[0].id;
      await q("INSERT INTO attendance(person_id,session_id,venue_id,status,method) SELECT unnest($1::int[]),$2,1,'valid','manual'",[people,session]);
      const detail=[{id:1,position:'Pengawas',name:'Sumber dikenal',institution:'Sekolah Dikenal',arrival_status:'selesai'}, {id:2,position:'Pengawas',name:'Peserta baru',institution:'Sekolah Baru',arrival_status:'selesai'}];
      await q('INSERT INTO venue_arrival_recap(venue_id,marks,detail_rows,source_summary) VALUES(1,$1,$2,$3) ON CONFLICT(venue_id) DO UPDATE SET detail_rows=EXCLUDED.detail_rows,source_summary=EXCLUDED.source_summary',[JSON.stringify({}),JSON.stringify(detail),JSON.stringify([{position:'Pengawas',invited:413,arrived:384,queued:24}])]);
    });
    const rows=await(await request(`/admin/venue-attendance?event=3&test_session_id=${session}`)).json();
    const count=rows.find(v=>v.id===1).pengawas;assert.equal(count.total,413);assert.equal(count.attended,1);assert.equal(count.registered,1);assert.equal(count.unresolved,1);assert.equal(count.source,'arrival');
    const details=await(await request(`/admin/venue-attendance/1/pengawas?event=3&test_session_id=${session}`)).json();
    assert.equal(details.length,2);assert.ok(!details.some(d=>d.name==='Profil tambahan'));assert.equal(details.filter(d=>d.people[0].status==='valid').length,1);
    assert.equal(details.find(d=>d.name==='Peserta baru').people[0].registered,false);
    assert.equal((await scoped(3,()=>q('SELECT count(*)::int n FROM attendance WHERE session_id=$1',[session]))).rows[0].n,2);
  } finally {
    await scoped(3,async()=>{
      if(session){await q('DELETE FROM attendance WHERE session_id=$1',[session]);await q('DELETE FROM sessions WHERE id=$1',[session]);}
      await q('DELETE FROM people WHERE id=ANY($1::int[])',[people]);
      if(prior)await q('UPDATE venue_arrival_recap SET detail_rows=$1,source_summary=$2 WHERE venue_id=1',[JSON.stringify(prior.detail_rows),JSON.stringify(prior.source_summary)]);else await q('DELETE FROM venue_arrival_recap WHERE venue_id=1');
      await(priorRoster?q('UPDATE assignment_roster SET data=$1 WHERE id=1',[JSON.stringify(priorRoster.data)]):q('DELETE FROM assignment_roster WHERE id=1'));
    });
  }
});

test('session status details paginate and enforce the LO venue scope', async () => {
  let sessionId, otherVenueId;
  await scoped(3,async()=>{
    otherVenueId=(await q("INSERT INTO venues(name,lat,lng) VALUES('Status other venue',-6,106) RETURNING id")).rows[0].id;
    sessionId=(await q("INSERT INTO sessions(name,role,starts_at,ends_at) VALUES('Status details test','semua',now()-interval '1 hour',now()+interval '1 hour') RETURNING id")).rows[0].id;
    for(const venueId of [1,otherVenueId]){
      const person=(await q("INSERT INTO people(code,name,role,venue_id) VALUES($1,$2,'peserta',$3) RETURNING id",[`status-person-${venueId}`,`Status Person ${venueId}`,venueId])).rows[0];
      await q("INSERT INTO attendance(person_id,session_id,venue_id,status,photo_path) VALUES($1,$2,$3,'valid','status.jpg')",[person.id,sessionId,venueId]);
      await q("INSERT INTO attempt_logs(person_id,session_id,venue_id,reasons) VALUES($1,$2,$3,'[\"outside_radius\"]')",[person.id,sessionId,venueId]);
    }
  });
  const token=signAdmin({role:'lo',username:'lo-sama',accounts:[{event:3,id:1}]});
  const path=`/admin/sessions/${sessionId}/status-details?event=3`;
  const all=await (await request(`${path}&status=valid&limit=1`)).json();
  assert.equal(all.total,2);assert.equal(all.rows.length,1);
  const next=await (await request(`${path}&status=valid&limit=1&offset=1`)).json();
  assert.notEqual(next.rows[0].id,all.rows[0].id);
  for(const status of ['valid','blocked']){
    const own=await (await request(`${path}&status=${status}&venue_id=${otherVenueId}`,{token})).json();
    assert.equal(own.total,1);assert.equal(own.rows[0].name,'Status Person 1');
    assert.equal(Object.hasOwn(own.rows[0],'ip'),false);
  }
  assert.equal((await request(`${path}&status=unknown`)).status,400);
  const otherStage=await (await request(`/admin/sessions/${sessionId}/status-details?event=4&status=valid`)).json();
  assert.equal(otherStage.total,0);
});

test('verification returns the representative and searches both attendee and original names', async () => {
  await scoped(3, async () => {
    const {rows:[person]} = await q(`INSERT INTO people(code,name,role,position,venue_id)
      VALUES('representative-test','Original Representative Test','peserta','Pengawas',1) RETURNING id`);
    await q(`INSERT INTO attendance(person_id,session_id,venue_id,status,photo_path) VALUES($1,1,1,'valid','representative-test.jpg')`,[person.id]);
    await q(`INSERT INTO venue_arrival_recap(venue_id,marks,representatives) VALUES(1,'{}',$1::jsonb)
      ON CONFLICT(venue_id) DO UPDATE SET representatives=EXCLUDED.representatives`,
      [JSON.stringify({[person.id]:{name:'Replacement Representative Test',original_name:person.name}})]);
  });
  for (const search of ['Original Representative Test','Replacement Representative Test']) {
    const response=await request(`/admin/attendance?event=3&session_id=1&q=${encodeURIComponent(search)}`);
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.total,1);
    assert.equal(data.counts.valid,1);
    assert.equal(data.rows[0].name,'Original Representative Test');
    assert.equal(data.rows[0].representative.name,'Replacement Representative Test');
  }
});

test('an explicit identity merge updates old sessions and new logins without matching passwords or names', async () => {
  const ids={};
  for(const event of [3,4])await scoped(event,async()=>{
    ids[event]=(await q('INSERT INTO lo_accounts(name,username,password_hash,venue_id) VALUES($1,$2,$3,(SELECT id FROM venues LIMIT 1)) RETURNING id',
      ['Canonical Name',`merged-${event}`,hashPassword(`password-${event}`)])).rows[0].id;
  });
  const token=signAdmin({role:'lo',username:'merged-3',accounts:[{event:3,id:ids[3]}]});
  const before=await (await request('/admin/me?event=4',{token})).json();
  assert.equal(before.no_assignment,true);
  await rawPool.query(`CREATE TABLE public.lo_account_links(group_id uuid NOT NULL,event_id int NOT NULL,account_id int NOT NULL,PRIMARY KEY(event_id,account_id));
    INSERT INTO public.lo_account_links VALUES('00000000-0000-4000-8000-000000000001',3,${ids[3]}),('00000000-0000-4000-8000-000000000001',4,${ids[4]})`);
  invalidateIdentityLinks();
  const after=await request('/admin/me?event=4',{token});
  assert.equal(after.status,200);assert.equal((await after.json()).no_assignment,undefined);
  const login=await request('/admin/login?event=4',{method:'POST',token:null,body:{username:'merged-3',password:'password-3'}});
  assert.equal(login.status,200);const data=await login.json();assert.equal(data.event.id,3);
  assert.equal((await request('/admin/me?event=3',{token:data.token})).status,200);
  assert.equal((await request('/admin/login?event=4',{method:'POST',token:null,body:{username:'merged-3',password:'wrong'}})).status,401);
  const failedChange=await request('/admin/me/password?event=3',{method:'POST',token,body:{old_password:'wrong',new_password:'linked-new-password'}});
  assert.equal(failedChange.status,400);
  const changed=await request('/admin/me/password?event=3',{method:'POST',token,body:{old_password:'password-3',new_password:'linked-new-password'}});
  assert.equal(changed.status,200);
  for (const event of [3,4]) {
    assert.equal((await request('/admin/login',{method:'POST',token:null,body:{username:`merged-${event}`,password:`password-${event}`}})).status,401);
    assert.equal((await request('/admin/login',{method:'POST',token:null,body:{username:`merged-${event}`,password:'linked-new-password'}})).status,200);
  }
  assert.equal((await request('/admin/login',{method:'POST',token:null,body:{username:'lo-sama',password:'test-lo-password'}})).status,200);
  await scoped(4,()=>q('UPDATE lo_accounts SET active=false WHERE id=$1',[ids[4]]));
  assert.equal((await request('/admin/me?event=4',{token:data.token})).status,401);
});
