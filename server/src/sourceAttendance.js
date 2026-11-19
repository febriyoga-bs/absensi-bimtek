// Source invitations define the target population. Profile IDs are only used to
// attach actual session attendance; an ambiguous identity must not count twice.
const key = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const schoolKey = value => key(String(value ?? '').toLowerCase().replace(/\bsd\s*n(?=\s|\d|[.-])/g, 'sd negeri '));
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
  const rows = source.detail_rows.filter(row => positionKey(row.position) === positionKey(position)).filter(row => {
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
    return { row, match: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 };
  });
  const occurrences = new Map();
  for (const { match } of rows) if (match) occurrences.set(match.id,(occurrences.get(match.id) || 0) + 1);
  const details = rows.map(({ row, match, ambiguous }) => {
    const conflict = !!match && occurrences.get(match.id) > 1;
    const registered = !!match && !conflict;
    return { name: row.name && row.name !== '-' ? row.name : row.institution || 'Nama belum tersedia',
      institution: row.institution, npsn: registered ? match.npsn : null, room: registered ? match.room : null,
      source_based: true, profile_issue: conflict ? 'Beberapa peserta sumber menuju profil yang sama'
        : ambiguous ? 'Beberapa profil cocok; perlu pastikan identitas' : !registered ? 'Profil belum cocok dengan sumber kehadiran' : null,
      people: [{ name: row.name && row.name !== '-' ? row.name : row.institution || 'Nama belum tersedia', registered,
        status: registered ? match.status_by_venue[source.venue_id] ?? null : null, arrival_status: row.arrival_status }] };
  }).sort((a,b) => a.name.localeCompare(b.name,'id'));
  const count = { total: summary.reduce((n,row) => n + row.invited,0),
    registered: details.filter(row => row.people[0].registered).length,
    attended: details.filter(row => ['valid','review'].includes(row.people[0].status)).length,
    source: 'arrival', detail_count: details.length,
    unresolved: details.filter(row => !row.people[0].registered).length };
  return { count, details };
}
