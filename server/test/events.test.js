import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { rawPool, pool, q, migrate } from '../src/db.js';
import { eventContext, eventId, searchPathSql } from '../src/eventContext.js';
import { reportingDates } from '../src/reportingDays.js';
import { signAdmin, signChallenge, verifyChallenge, hashPassword } from '../src/auth.js';
import app from '../src/app.js';

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
  const token = await scoped(3, () => signAdmin({ role: 'lo', username: 'lo-sama' }));
  assert.equal((await request('/admin/me?event=3', { token })).status, 200);
  assert.equal((await request('/admin/me?event=4', { token })).status, 401);
  const challenge = await scoped(3, () => signChallenge(1, 1, 'nonce'));
  assert.ok(await scoped(3, () => verifyChallenge(challenge)));
  assert.equal(await scoped(4, () => verifyChallenge(challenge)), null);
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
  const lo = await scoped(3, () => signAdmin({ role: 'lo', username: 'lo-sama' }));
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
