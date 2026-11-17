import { searchPathSql } from './eventContext.js';
import { eventSql } from './unifiedStorage.js';

/** Keep every checkout scoped, including callers that do not open a transaction. */
export function scopedConnection(client, event) {
  let transaction = false;
  return {
    async query(text, params) {
      if (typeof text === 'string' && /^\s*BEGIN\s*;?\s*$/i.test(text)) {
        const result = await client.query('BEGIN');
        transaction = true;
        await client.query(searchPathSql(event));
        return result;
      }
      if (transaction) {
        const result = await client.query(eventSql(text), params);
        if (typeof text === 'string' && /^\s*(COMMIT|ROLLBACK)\s*;?\s*$/i.test(text)) transaction = false;
        return result;
      }
      try {
        await client.query(`BEGIN; ${searchPathSql(event)}`);
        const result = await client.query(eventSql(text), params);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    },
    release: (...args) => client.release(...args),
  };
}
