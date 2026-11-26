const detailFilters = {
  assigned: 'true', present: 't.present', target: 't.present',
  completed: 't.work_id IS NOT NULL', unavailable: "t.status='berhalangan'",
  participants: "t.status<>'berhalangan' AND t.is_participant",
  facilitators: "t.status<>'berhalangan' AND NOT t.is_participant",
};

// Normalize each person/mapping once, then match codes and individual school IDs
// with equality joins. UNION removes duplicate assignments and overlapping NPSNs.
export function attendanceRankingSql(metric = null) {
  if (metric !== null && !Object.hasOwn(detailFilters, metric)) throw new Error('Invalid ranking metric');
  return `WITH owners AS MATERIALIZED (
    SELECT l.id,l.name,l.venue_id,v.name AS venue,
      count(*) OVER (PARTITION BY l.venue_id,l.name) AS same_name
    FROM lo_accounts l JOIN venues v ON v.id=l.venue_id
  ), selected_sessions AS MATERIALIZED (
    SELECT id,role,venue_ids FROM sessions WHERE NOT is_test AND ($1::int IS NULL OR id=$1)
  ), candidate_people AS MATERIALIZED (
    SELECT p.id,p.venue_id,lower(p.code) AS code_key,lower(trim(p.position)) AS position_key,
      regexp_replace(lower(p.name),'[^[:alnum:]]','','g') AS name_key,
      string_to_array(replace(p.npsn,' ',''),';') AS school_ids
    FROM people p WHERE p.archived_at IS NULL AND p.role='peserta'
      AND (lower(trim(p.position)) IN ('bendahara','pengawas','kepala sekolah')
        OR lower(trim(p.position)) ~ '^(verifikator|fasil(itator)?)($|[[:space:]])')
      AND ($1::int IS NULL OR EXISTS (SELECT 1 FROM selected_sessions s
        WHERE s.role IN ('peserta','semua') AND (cardinality(COALESCE(s.venue_ids,'{}'))=0 OR p.venue_id=ANY(s.venue_ids))))
  ), mappings AS MATERIALIZED (
    SELECT l.id AS owner_id,m.venue_id,lower(m.code) AS code_key,lower(trim(m.position)) AS position_key,
      regexp_replace(lower(m.name),'[^[:alnum:]]','','g') AS name_key,
      string_to_array(replace(m.npsn,' ',''),';') AS school_ids
    FROM assignment_roster r
    CROSS JOIN LATERAL jsonb_each(r.data->'attendance_assignments') entries
    JOIN owners l ON entries.key=l.id::text
    CROSS JOIN LATERAL jsonb_to_recordset(entries.value) AS m(code text,name text,position text,npsn text,venue_id int)
    WHERE r.id=1 AND m.venue_id=l.venue_id
  ), person_schools AS MATERIALIZED (
    SELECT p.id,p.venue_id,p.position_key,p.name_key,unnest(p.school_ids) AS school_id FROM candidate_people p
  ), mapping_schools AS MATERIALIZED (
    SELECT m.owner_id,m.venue_id,m.position_key,m.name_key,unnest(m.school_ids) AS school_id FROM mappings m
  ), targets AS MATERIALIZED (
    SELECT m.owner_id,p.id AS person_id FROM candidate_people p JOIN mappings m
      ON p.venue_id=m.venue_id AND p.position_key=m.position_key AND p.name_key=m.name_key AND p.code_key=m.code_key
    UNION
    SELECT m.owner_id,p.id AS person_id FROM person_schools p JOIN mapping_schools m
      ON p.venue_id=m.venue_id AND p.position_key=m.position_key AND p.name_key=m.name_key AND p.school_id=m.school_id
  ), session_attendance AS MATERIALIZED (
    SELECT a.id,a.person_id,a.venue_id,a.scanned_by,a.method,a.status,a.created_at${metric ? ',a.participant_note' : ''}
    FROM attendance a JOIN selected_sessions s ON s.id=a.session_id
    WHERE a.status IN ('valid','review','berhalangan')
  ), presence AS MATERIALIZED (
    SELECT DISTINCT person_id,venue_id FROM session_attendance WHERE status IN ('valid','review')
  ), work AS MATERIALIZED (
    SELECT DISTINCT ON (scanned_by,venue_id,person_id) * FROM session_attendance
    WHERE method IN ('manual','qr')
    ORDER BY scanned_by,venue_id,person_id,CASE WHEN status='berhalangan' THEN 1 ELSE 0 END,created_at DESC
  ), target_results AS MATERIALIZED (
    SELECT t.owner_id,t.person_id,(e.person_id IS NOT NULL) AS present,
      p.position_key IN ('bendahara','pengawas','kepala sekolah') AS is_participant,
      a.id AS work_id,a.status${metric ? ',a.created_at,a.participant_note' : ''}
    FROM targets t JOIN owners l ON l.id=t.owner_id JOIN candidate_people p ON p.id=t.person_id
    LEFT JOIN presence e ON e.person_id=t.person_id AND e.venue_id=l.venue_id
    LEFT JOIN work a ON l.same_name=1 AND a.venue_id=l.venue_id AND a.person_id=t.person_id AND a.scanned_by='LO '||l.name
  )
  ${metric ? `SELECT p.id,p.name,p.institution,p.position,p.npsn,l.venue,t.present,t.status,t.created_at,t.participant_note
    FROM target_results t JOIN owners l ON l.id=t.owner_id JOIN people p ON p.id=t.person_id
    WHERE t.owner_id=$2 AND (${detailFilters[metric]}) ORDER BY p.name,p.id` : `SELECT l.id,l.name,l.venue,
    count(t.person_id)::int AS assigned,
    count(*) FILTER (WHERE t.present)::int AS present,
    count(*) FILTER (WHERE t.status<>'berhalangan' AND t.is_participant)::int AS participants,
    count(*) FILTER (WHERE t.status<>'berhalangan' AND NOT t.is_participant)::int AS facilitators,
    count(*) FILTER (WHERE t.status<>'berhalangan')::int AS total,
    count(*) FILTER (WHERE t.status='berhalangan')::int AS unavailable,
    count(*) FILTER (WHERE t.status='berhalangan' AND NOT t.present)::int AS unavailable_absent
    FROM owners l LEFT JOIN target_results t ON t.owner_id=l.id
    GROUP BY l.id,l.name,l.venue ORDER BY total DESC,l.name,l.id`}`;
}
