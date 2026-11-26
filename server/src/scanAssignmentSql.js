// Separate exact-code and school-ID matching so PostgreSQL can use equality
// joins, rather than compare arrays and normalize names for every possible pair.
export function scanAssignmentSql(event) {
  return `candidate_school_ids AS MATERIALIZED (
      SELECT p.id,p.venue_id,p.position_key,p.name_key,unnest(p.school_ids) AS school_id
      FROM candidate_people p
    ), mapping_school_ids AS MATERIALIZED (
      SELECT m.account_id,m.lo_name,m.venue_id,m.position,m.name_key,unnest(m.school_ids) AS school_id
      FROM mappings m
    ), assigned_people AS MATERIALIZED (
      SELECT p.id,m.account_id,m.lo_name
      FROM candidate_people p JOIN mappings m ON p.venue_id=m.venue_id
        AND p.position_key=m.position AND p.code_key=m.code AND p.name_key=m.name_key
      UNION
      SELECT p.id,m.account_id,m.lo_name
      FROM candidate_school_ids p JOIN mapping_school_ids m
        ON p.venue_id=m.venue_id AND p.position_key=m.position AND p.school_id=m.school_id
      WHERE p.name_key=m.name_key
        OR (${event === 5 ? 'true' : 'false'} AND p.position_key IN ('kepala sekolah','bendahara'))
      UNION
      SELECT p.id,l.id,l.name FROM candidate_people p JOIN active_owners l ON p.venue_id=l.venue_id
      WHERE p.role='peserta' AND p.archived_at IS NULL AND lower(trim(p.position)) IN ('dinas pendidikan','bb/bpmp')
    )`;
}
