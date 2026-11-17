import { rawPool } from './db.js';
import { createAsyncCache } from './asyncCache.js';
const linksCache=createAsyncCache({ttl:5000,maxEntries:256});
export const invalidateIdentityLinks = () => linksCache.clear();

// Explicit account links are written only by an authorized identity merge.
// Never infer ownership from a similar name or username alone.
export async function identityGrants(grants) {
  return linksCache.get(JSON.stringify(grants),async()=>{
  const {rows:[table]} = await rawPool.query("SELECT to_regclass('public.lo_account_links') AS name");
  if (!table.name) return grants;
  const {rows:links} = await rawPool.query(`WITH source AS (
      SELECT DISTINCT l.group_id FROM public.lo_account_links l
      JOIN jsonb_to_recordset($1::jsonb) AS g(event int,id int) ON g.event=l.event_id AND g.id=l.account_id
    ) SELECT l.event_id AS event,l.account_id AS id FROM public.lo_account_links l JOIN source s USING(group_id)`,[JSON.stringify(grants)]);
  return [...new Map([...grants,...links].map((grant)=>[`${grant.event}:${grant.id}`,grant])).values()];
  });
}
