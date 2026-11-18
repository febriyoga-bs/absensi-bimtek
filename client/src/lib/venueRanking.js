const sentStatuses = new Set(['menunggu_reviu', 'ditolak', 'diterima', 'sudah_direviu']);
const knownStatuses = new Set(['belum_kirim', ...sentStatuses]);

export function rankVenues(schools, venues = [], baseline = '') {
  const groups = new Map(venues.map((name) => [name, []]));
  for (const school of schools) {
    const name = school.venue || 'Venue belum tersedia';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(school);
  }
  return [...groups].map(([name, group]) => {
    const sent = group.filter((s) => sentStatuses.has(s.status)).length;
    const accepted = group.filter((s) => s.status === 'diterima').length;
    const change = group.filter((s) => sentStatuses.has(s.status) && baseline && s.submitted_on && s.submitted_on >= baseline).length;
    return { name, total: group.length, sent, accepted, change,
      pending: group.filter((s) => s.status === 'menunggu_reviu').length,
      known: group.filter((s) => knownStatuses.has(s.status)).length,
      ratio: group.length ? change * 100 / group.length : 0,
      sentRatio: group.length ? sent * 100 / group.length : 0,
      acceptedRatio: group.length ? accepted * 100 / group.length : 0 };
  }).sort((a, b) => Number(b.known > 0) - Number(a.known > 0)
    || b.ratio - a.ratio || b.sentRatio - a.sentRatio || b.acceptedRatio - a.acceptedRatio || b.change - a.change
    || a.name.localeCompare(b.name, 'id', { numeric: true }))
    .map((row, index) => ({ ...row, rank: row.known ? index + 1 : null }));
}
