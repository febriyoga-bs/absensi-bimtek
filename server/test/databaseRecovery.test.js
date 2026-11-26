import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawPool, q } from '../src/db.js';

test('database errors release or discard connections without reusing timed-out clients', async () => {
  const originalQuery = rawPool.query, originalConnect = rawPool.connect;
  rawPool.query = async () => ({ rows: [] });
  try {
    for (const kind of ['timeout', 'sql', 'rollback', 'success']) {
      const commands = [], releases = [];
      const error = new Error(kind === 'timeout' ? 'Query read timeout' : 'bad SQL');
      rawPool.connect = async () => ({
        async query(sql) {
          commands.push(sql);
          if (sql === 'SELECT example' && kind !== 'success') throw error;
          if (sql === 'ROLLBACK' && kind === 'rollback') throw new Error('connection lost');
          return { rows: [] };
        },
        release(error) { releases.push(error); },
      });
      if (kind === 'success') await q('SELECT example');
      else await assert.rejects(q('SELECT example'), error);
      assert.equal(releases.length, 1);
      assert.equal(commands.includes('ROLLBACK'), kind === 'sql' || kind === 'rollback');
      assert.equal(!!releases[0], kind === 'timeout' || kind === 'rollback');
    }
  } finally {
    rawPool.query = originalQuery;
    rawPool.connect = originalConnect;
    await rawPool.end();
  }
});
