// Accounts imported for a new event may not yet have an attendance profile.
// Never overwrite an existing person: their attendance and identity must survive.
export async function ensureRosterLoProfiles(query) {
  return query(`INSERT INTO people(code,name,role,position,venue_id,roster_added_at)
    SELECT l.username,l.name,'panitia','LO',l.venue_id,now() FROM lo_accounts l
    WHERE l.active AND EXISTS (SELECT 1 FROM assignment_roster r
      CROSS JOIN LATERAL jsonb_to_recordset(r.data->'lo') AS owner(account_id int,venue_id int)
      WHERE r.id=1 AND owner.account_id=l.id AND owner.venue_id=l.venue_id)
      AND NOT EXISTS (SELECT 1 FROM people p WHERE lower(p.code)=lower(l.username))
    ON CONFLICT (lower(code)) DO NOTHING RETURNING id,code,name,venue_id`);
}

export async function getLoProfile(user, query) {
  await query(
    `INSERT INTO people (code,name,role,position,venue_id,roster_added_at)
     SELECT l.username,l.name,'panitia','LO',l.venue_id,now()
     FROM lo_accounts l
     WHERE l.id=$1 AND l.venue_id=$2 AND l.active
       AND NOT EXISTS (SELECT 1 FROM people p WHERE lower(p.code)=lower(l.username))
     ON CONFLICT DO NOTHING`,
    [user.lo, user.venue]);
  const { rows: [person] } = await query(
    `SELECT p.* FROM lo_accounts l JOIN people p
       ON lower(p.code)=lower(l.username) AND p.venue_id=l.venue_id
     WHERE l.id=$1 AND l.venue_id=$2 AND l.active
       AND p.role='panitia' AND lower(trim(p.position))='lo' AND p.archived_at IS NULL`,
    [user.lo, user.venue]);
  return person;
}
