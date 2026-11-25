// All PKS verifiers are confirmed present at their assigned venue.
export function pksVerifierArrivalSql(position, fallback, event) {
  if (event !== 5) return fallback;
  return `CASE WHEN lower(trim(${position})) ~ '^(verifikator|fasil(itator)?)($|[[:space:]])' THEN 'sudah_tiba' ELSE ${fallback} END`;
}
