// Source invitations define the target population. Profile IDs are only used to
// attach actual session attendance; an ambiguous identity must not count twice.
const key = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const schoolKey = value => key(String(value ?? '').toLowerCase().replace(/\bsd\s*n(?=\s|\d|[.-])/g, 'sd negeri '));
// School identifiers take precedence; school-name fallback ignores administrative prefixes.
const schoolIdentity = value => schoolKey(String(value ?? '').replace(/^(?:\s*(?:UPT(?:D)?|SPF|SATUAN PENDIDIKAN FORMAL)\b[.\s]*)+/i, ''));
const schoolIds = value => String(value ?? '').split(';').map(v => v.trim()).filter(v => /^\d{8}$/.test(v));
const personKey = value => key(String(value ?? '').split(',')[0].replace(/\b(?:s\.?\s*pd|s\.?\s*pd\.?\s*sd|m\.?\s*pd|gr)\b.*$/i, ''));
function similarName(a, b) {
  a = personKey(a); b = personKey(b);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 7) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j-1]+1, previous[j]+1, previous[j-1]+(a[i-1] === b[j-1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length] / Math.max(a.length, b.length) <= 0.2;
}
const positionKey = value => key(value) === 'sekolah' ? 'bendahara' : key(value);
export function sourceAttendance(source, profiles, position) {
  const summary = source?.source_summary?.filter(row => positionKey(row.position) === positionKey(position));
  if (!summary?.length || !Array.isArray(source.detail_rows)) return null;
  const candidates = profiles.filter(p => p.venue_id === source.venue_id && positionKey(p.position) === positionKey(position));
  const byName = new Map(), bySchool = new Map();
  const index = (map, identity, person) => { if (identity) { if (!map.has(identity)) map.set(identity, []); map.get(identity).push(person); } };
  for (const p of candidates) {
    index(byName, key(p.name), p);
    for (const identity of new Set((p.institution || '').split(';').map(schoolKey))) index(bySchool, identity, p);
  }
  const seen = new Set();
  const rows = source.detail_rows.filter(row => key(row.confirmation_status) !== 'belumkonfirmasi' && key(row.arrival_status) !== 'belumkonfirmasi' && positionKey(row.position) === positionKey(position)).filter(row => {
    const identity = JSON.stringify([key(row.name),schoolKey(row.institution)]);
    if (seen.has(identity)) return false; seen.add(identity); return true;
  }).map(row => {
    const institution = schoolKey(row.institution);
    const usableSchool = institution && !['belumada','tidakada','na'].includes(institution);
    let matches = positionKey(position) === 'pengawas' ? byName.get(key(row.name)) || []
      : usableSchool ? bySchool.get(institution) || [] : [];
    if (matches.length > 1) {
      const named = matches.filter(p => key(p.name) === key(row.name));
      if (named.length === 1) matches = named;
    }
    if (matches.length > 1 && usableSchool) matches = matches.filter(p => (p.institution || '').split(';').some(part => schoolKey(part) === institution));
    if (!matches.length && usableSchool) matches = bySchool.get(institution) || [];
    const explicit = row.profile_id == null ? [] : candidates.filter(p => p.id === row.profile_id);
    const ids = schoolIds(row.npsn);
    if (ids.length || matches.length !== 1) {
      const schoolMatches = candidates.filter(p => ids.length
        ? schoolIds(p.npsn).some(id => ids.includes(id))
        : usableSchool && (p.institution || '').split(';').some(part => schoolIdentity(part) === schoolIdentity(row.institution)));
      const similar = schoolMatches.filter(p => similarName(row.name, p.name));
      // Never choose arbitrarily between profiles or fall back from a conflicting NPSN.
      matches = similar.length === 1 ? similar : ids.length ? similar : matches;
    }
    if (explicit.length === 1) matches = explicit;
    return { row, match: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 };
  });
  const occurrences = new Map();
  for (const { match } of rows) if (match) occurrences.set(match.id,(occurrences.get(match.id) || 0) + 1);
  const details = rows.map(({ row, match, ambiguous }) => {
    const conflict = !!match && occurrences.get(match.id) > 1;
    const registered = !!match && !conflict;
    return { name: row.name && row.name !== '-' ? row.name : row.institution || 'Nama belum tersedia',
      institution: row.institution, npsn: registered ? match.npsn : null, room: registered ? match.room : null,
      source_profile_id: match?.id ?? null, source_based: true, profile_issue: conflict ? 'Beberapa peserta sumber menuju profil yang sama'
        : ambiguous ? 'Beberapa profil cocok; perlu pastikan identitas' : !registered ? 'Profil belum cocok dengan sumber kehadiran' : null,
      people: [{ name: row.name && row.name !== '-' ? row.name : row.institution || 'Nama belum tersedia', registered,
        status: registered ? match.status_by_venue[source.venue_id] ?? null : null, arrival_status: row.arrival_status }] };
  }).sort((a,b) => a.name.localeCompare(b.name,'id'));
  const count = { total: summary.reduce((n,row) => n + row.invited,0),
    arrivalTarget: details.filter(row => ['selesai','sudah_tiba','sedang_antre'].includes(row.people[0].arrival_status)).length,
    registered: details.filter(row => row.people[0].registered).length,
    attended: details.filter(row => ['valid','review'].includes(row.people[0].status)).length,
    recorded: details.filter(row => ['valid','review','berhalangan'].includes(row.people[0].status)).length,
    source: 'arrival', detail_count: details.length,
    unresolved: details.filter(row => !row.people[0].registered).length };
  return { count, details };
}
