// Expand the roster once per export, rather than once per participant and LO.
// Keep this matching equivalent to assignedToLo(..., true) in routes/admin.js.
export const attendanceExportLoCtes = `
  export_owners AS MATERIALIZED (
    SELECT id, name, venue_id FROM lo_accounts WHERE active
  ),
  export_assignments AS MATERIALIZED (
    SELECT owner.name AS owner_name, owner.venue_id AS owner_venue,
      m.venue_id, lower(trim(m.position)) AS position,
      regexp_replace(lower(m.name), '[^[:alnum:]]', '', 'g') AS name_key,
      lower(m.code) AS code,
      string_to_array(replace(m.npsn,' ',''),';') AS npsns
    FROM export_owners owner
    JOIN assignment_roster roster ON roster.id=1
    CROSS JOIN LATERAL jsonb_to_recordset(roster.data->'attendance_assignments'->(owner.id::text))
      AS m(code text,name text,position text,npsn text,venue_id int)
  ),
  export_lo_matches AS (
    SELECT p.id AS person_id, owner.name
    FROM people p JOIN export_owners owner ON owner.venue_id=p.venue_id
    WHERE p.role='peserta' AND lower(trim(p.position)) IN ('dinas pendidikan','bb/bpmp')
    UNION ALL
    SELECT p.id AS person_id, m.owner_name AS name
    FROM people p JOIN export_assignments m
      ON m.owner_venue=p.venue_id AND m.venue_id=p.venue_id
      AND m.position=lower(trim(p.position))
      AND m.name_key=regexp_replace(lower(p.name), '[^[:alnum:]]', '', 'g')
      AND (m.code=lower(p.code) OR m.npsns && string_to_array(replace(p.npsn,' ',''),';'))
    WHERE p.role='peserta'
  ),
  export_assigned_lo AS (
    SELECT person_id, string_agg(DISTINCT name, '; ' ORDER BY name) AS assigned_lo
    FROM export_lo_matches GROUP BY person_id
  )`;
