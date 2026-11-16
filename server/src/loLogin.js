import { rawPool } from './db.js';
import { eventSchema } from './eventContext.js';
import { verifyPassword } from './auth.js';
import { HttpError } from './util.js';

// Authentication searches accounts independently of the selected activity.
// Each grant is still tied to an account whose credentials were verified.
export async function loginLo(username, password, preferredEvent) {
  if (username.length > 128 || password.length > 1024) throw new HttpError(401, 'Username atau password salah');
  const { rows: events } = await rawPool.query('SELECT id,name,status,schema_name FROM public.bimtek_events ORDER BY id');
  const matches = [];
  for (const event of events) {
    const schema = eventSchema(event);
    const { rows: [account] } = await rawPool.query(
      `SELECT l.*, v.name AS venue_name FROM "${schema}".lo_accounts l JOIN "${schema}".venues v ON v.id=l.venue_id
       WHERE lower(l.username)=lower($1)`, [username]);
    if (account && verifyPassword(password, account.password_hash)) matches.push({ account, event });
  }
  if (!matches.length) throw new HttpError(401, 'Username atau password salah');
  const allowed = matches.filter(({ account }) => account.active);
  if (!allowed.length) throw new HttpError(403, 'Akun LO ini dinonaktifkan. Hubungi admin utama.');
  const chosen = allowed.find(({ event }) => event.id === Number(preferredEvent))
    || allowed.find(({ event }) => event.status === 'active') || allowed.at(-1);
  const { account, event } = chosen;
  await rawPool.query(`UPDATE "${eventSchema(event)}".lo_accounts SET last_login_at=now() WHERE id=$1`, [account.id]);
  return {
    claims: { role: 'lo', username: account.username, accounts: allowed.map(({ account: a, event: e }) => ({ event: e.id, id: a.id })) },
    user: { role: 'lo', name: account.name, venue: { id: account.venue_id, name: account.venue_name },
      events: allowed.map(({ event: e }) => ({ id: e.id, name: e.name, status: e.status })) },
    event: { id: event.id, name: event.name, status: event.status },
  };
}
