import { rawPool, ensureStorageMode } from './db.js';
import { eventId, eventSchema } from './eventContext.js';
import { unifiedStorage } from './unifiedStorage.js';
import { identityGrants } from './loIdentity.js';
import { hashPassword, verifyPassword } from './auth.js';
import { HttpError } from './util.js';

// Only explicitly linked identities share a password; matching names do not.
export async function changeLoPassword(accountId, oldPassword, newPassword) {
  await ensureStorageMode();
  const grants = await identityGrants([{ event: eventId(), id: accountId }]);
  const { rows: events } = await rawPool.query('SELECT id,schema_name FROM public.bimtek_events ORDER BY id');
  const client = await rawPool.connect();
  try {
    await client.query('BEGIN');
    const accounts = [];
    for (const grant of [...grants].sort((a,b) => a.event-b.event || a.id-b.id)) {
      const event = events.find((event) => event.id === grant.event);
      if (!event) continue;
      const table = unifiedStorage() ? 'public.event_lo_accounts' : `"${eventSchema(event)}".lo_accounts`;
      const where = unifiedStorage() ? 'id=$1 AND event_id=$2' : 'id=$1';
      const params = unifiedStorage() ? [grant.id, grant.event] : [grant.id];
      const { rows: [account] } = await client.query(`SELECT active,password_hash FROM ${table} WHERE ${where} FOR UPDATE`, params);
      accounts.push({ grant, table, where, params, account });
    }
    const own = accounts.find(({grant}) => grant.event === eventId() && grant.id === accountId)?.account;
    if (!own?.active) throw new HttpError(401, 'Akun LO tidak aktif. Silakan login ulang.');
    if (!verifyPassword(oldPassword, own.password_hash)) throw new HttpError(400, 'Password lama salah.');
    const hash = hashPassword(newPassword);
    for (const { table, where, params, account } of accounts) {
      if (account) await client.query(`UPDATE ${table} SET password_hash=$${params.length+1} WHERE ${where}`, [...params, hash]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
