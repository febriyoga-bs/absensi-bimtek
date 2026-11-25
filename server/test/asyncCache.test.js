import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAsyncCache } from '../src/asyncCache.js';

test('concurrent identical reads share one loader and invalidation forces fresh data', async () => {
  const cache = createAsyncCache(); let calls = 0;
  const load = async () => ++calls;
  assert.deepEqual(await Promise.all([cache.get('event4', load), cache.get('event4', load)]), [1, 1]);
  cache.clear();
  assert.equal(await cache.get('event4', load), 2);
  assert.equal(await cache.get('event3', load), 3);
});

test('an in-flight read cannot repopulate a cache after invalidation', async () => {
  const cache = createAsyncCache(); let resolve;
  const old = cache.get('key', () => new Promise((done) => { resolve = done; }));
  await Promise.resolve(); cache.clear();
  assert.equal(await cache.get('key', async () => 'new'), 'new');
  resolve('old'); await old;
  assert.equal(await cache.get('key', async () => 'wrong'), 'new');
});
test('bounded stale fallback preserves successful data and marks it during an upstream error',async()=>{
 const cache=createAsyncCache({ttl:-1,staleIfError:10000,describeStale:value=>({...value,stale:true})});
 await cache.get('ranking',async()=>({total:42}));
 const fallback=await cache.get('ranking',async()=>{throw new Error('429');});
 assert.deepEqual(fallback,{total:42,stale:true});
 cache.clear();
 await assert.rejects(cache.get('ranking',async()=>{throw new Error('429');}),/429/);
 const expired=createAsyncCache({ttl:-20000,staleIfError:10000});
 await expired.get('ranking',async()=>42);
 await assert.rejects(expired.get('ranking',async()=>{throw new Error('expired');}),/expired/);
});
