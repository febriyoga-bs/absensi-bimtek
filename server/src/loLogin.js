import { rawPool, ensureStorageMode } from './db.js';
import { unifiedStorage } from './unifiedStorage.js';
import { eventSchema } from './eventContext.js';
import { verifyPassword } from './auth.js';
import { HttpError } from './util.js';
import { identityGrants } from './loIdentity.js';

// Authentication searches accounts independently of the selected activity.
// Each grant is still tied to an account whose credentials were verified.
export async function loginLo(username, password, preferredEvent) {
  if (username.length > 128 || password.length > 1024) throw new HttpError(401, 'Username atau password salah');
  const { rows: events } = await rawPool.query('SELECT id,name,status,schema_name FROM public.bimtek_events ORDER BY id');
  const matches = [];
  await ensureStorageMode();
  for (const event of events) {
    if (event.id===2) continue;
    const schema = eventSchema(event);
    const { rows: [account] } = await rawPool.query(
      unifiedStorage() ? `SELECT l.*,v.name AS venue_name FROM public.event_lo_accounts l
        JOIN public.event_venues v ON v.event_id=l.event_id AND v.id=l.venue_id
        WHERE l.event_id=$2 AND lower(l.username)=lower($1)`
        : `SELECT l.*, v.name AS venue_name FROM "${schema}".lo_accounts l JOIN "${schema}".venues v ON v.id=l.venue_id
       WHERE lower(l.username)=lower($1)`, unifiedStorage() ? [username,event.id] : [username]);
    if (account && verifyPassword(password, account.password_hash)) matches.push({ account, event });
  }
  if (!matches.length) throw new HttpError(401, 'Username atau password salah');
  const allowed = matches.filter(({ account }) => account.active);
  if (!allowed.length) throw new HttpError(403, 'Akun LO ini dinonaktifkan. Hubungi admin utama.');
  const linked = await identityGrants(allowed.map(({account,event})=>({event:event.id,id:account.id})));
  for (const grant of linked) {
    if (allowed.some(({account,event})=>event.id===grant.event && account.id===grant.id)) continue;
    const event=events.find((event)=>event.id===grant.event);
    if (!event || event.id===2) continue;
    const schema=eventSchema(event);
    const {rows:[account]}=await rawPool.query(unifiedStorage()
      ? `SELECT l.*,v.name AS venue_name FROM public.event_lo_accounts l JOIN public.event_venues v ON v.event_id=l.event_id AND v.id=l.venue_id WHERE l.event_id=$2 AND l.id=$1 AND l.active`
      : `SELECT l.*,v.name AS venue_name FROM "${schema}".lo_accounts l JOIN "${schema}".venues v ON v.id=l.venue_id WHERE l.id=$1 AND l.active`,
      unifiedStorage()?[grant.id,event.id]:[grant.id]);
    if(account)allowed.push({account,event});
  }
  // A saved archive selection must not become the landing stage of a new login.
  const chosen = [...allowed].reverse().find(({ event }) => event.status === 'active')
    || allowed.find(({ event }) => event.id === Number(preferredEvent)) || allowed.at(-1);
  const { account, event } = chosen;
  await rawPool.query(unifiedStorage()
    ? 'UPDATE public.event_lo_accounts SET last_login_at=now() WHERE id=$1 AND event_id=$2'
    : `UPDATE "${eventSchema(event)}".lo_accounts SET last_login_at=now() WHERE id=$1`, unifiedStorage() ? [account.id,event.id] : [account.id]);
  return {
    claims: { role: 'lo', username: account.username, accounts: allowed.map(({ account: a, event: e }) => ({ event: e.id, id: a.id })) },
    user: { role: 'lo', name: account.name, venue: { id: account.venue_id, name: account.venue_name },
      events: events.map(({ id,name,status }) => ({ id,name,status })) },
    event: { id: event.id, name: event.name, status: event.status },
  };
}
