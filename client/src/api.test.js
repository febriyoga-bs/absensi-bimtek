import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, adminToken } from './api.js';
import { setSelectedEvent } from './event.js';

const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;
afterEach(() => { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; setSelectedEvent(null); });

test('simultaneous identical reads issue one fetch, while later reads remain fresh', async () => {
  let calls = 0, done;
  globalThis.fetch = async () => { calls++; await new Promise((resolve) => { done = resolve; }); return Response.json({ ok: true }); };
  const first = api('/test'); const second = api('/test');
  assert.equal(calls, 1); done();
  assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);
  const third = api('/test'); assert.equal(calls, 2); done(); await third;
});

test('reads never share responses across activities or login identities', async () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push([url, options.headers.Authorization]); return Response.json({ ok: true }); };
  setSelectedEvent({id:3}); adminToken.set('account-a'); const a = api('/me', {admin:true});
  setSelectedEvent({id:4}); const b = api('/me', {admin:true});
  adminToken.set('account-b'); const c = api('/me', {admin:true});
  await Promise.all([a,b,c]); assert.equal(calls.length, 3);
  assert.match(calls[0][0], /event=3/); assert.match(calls[1][0], /event=4/);
  assert.equal(calls[2][1], 'Bearer account-b');
});

test('writes are never deduplicated and failed reads can be retried', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ok:true}); };
  await Promise.all([api('/write',{method:'POST',body:{a:1}}), api('/write',{method:'POST',body:{a:1}})]);
  assert.equal(calls, 2);
  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(api('/retry'));
  globalThis.fetch = async () => Response.json({ok:true});
  assert.deepEqual(await api('/retry'), {ok:true});
});
