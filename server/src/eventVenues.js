// Historical tables may retain inactive venues prepared for another activity.
// Use the activity's roster as the source of venue membership, not active status.
export function eventVenueScope(alias = 'v') {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error('Alias venue tidak valid.');
  const names = `SELECT venue.name FROM assignment_roster roster
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(roster.data->'venues')='array' AND jsonb_array_length(roster.data->'venues')>0
        THEN roster.data->'venues'
        ELSE COALESCE((SELECT jsonb_agg(DISTINCT item->>'venue')
          FROM jsonb_array_elements(COALESCE(roster.data->'lo','[]'::jsonb)) item
          WHERE nullif(item->>'venue','') IS NOT NULL), '[]'::jsonb) END
    ) venue(name) WHERE roster.id=1`;
  return `(${alias}.name IN (${names}) OR (NOT EXISTS (${names}) AND ${alias}.active))`;
}
