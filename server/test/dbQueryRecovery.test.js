import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { rawPool, q } from '../src/db.js';

test('timeouts discard the connection, ordinary SQL errors roll back, and the next request succeeds', async () => {
  const queryBefore = rawPool.query, connectBefore = rawPool.connect;
  rawPool.query = async () => ({ rows: [] });
  try {
    const socket = new EventEmitter();
    rawPool.emit('connect', socket);
    const logBefore = console.error;
    console.error = () => {};
    try { assert.doesNotThrow(() => socket.emit('error', new Error('Connection terminated unexpectedly'))); }
    finally { console.error = logBefore; }
    for (const kind of ['timeout', 'sql', 'rollback', 'success']) {
      const commands = [], releases = [];
      const error = new Error(kind === 'timeout' ? 'Query read timeout' : 'invalid SQL');
      rawPool.connect = async () => ({
        async query(sql) {
          commands.push(sql);
          if (sql === 'SELECT fixture' && kind !== 'success') throw error;
          if (sql === 'ROLLBACK' && kind === 'rollback') throw new Error('connection lost');
          return { rows: [{ value: 1 }] };
        },
        release(reason) { releases.push(reason); },
      });
      if (kind === 'success') assert.equal((await q('SELECT fixture')).rows[0].value, 1);
      else await assert.rejects(q('SELECT fixture'), error);
      assert.equal(releases.length, 1);
      assert.equal(commands.includes('ROLLBACK'), kind === 'sql' || kind === 'rollback');
      assert.equal(!!releases[0], kind === 'timeout' || kind === 'rollback');
    }
  } finally {
    rawPool.query = queryBefore;
    rawPool.connect = connectBefore;
    await rawPool.end();
  }
});
