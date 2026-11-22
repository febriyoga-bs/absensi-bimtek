export function rankPksOwners(schools, owners, venue = '') {
  return owners.filter(owner => !venue || owner.venue === venue).map(owner => {
    const assigned = schools.filter(school => school.venue === owner.venue && school.lo === owner.name);
    const total = new Set(assigned.map(school => school.npsn)).size;
    const completed = new Set(assigned.filter(school => school.pks?.status === 'lengkap').map(school => school.npsn)).size;
    return { ...owner, total, completed, ratio: total ? completed * 100 / total : null };
  }).sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.completed - a.completed || a.name.localeCompare(b.name, 'id'))
    .map((row, index) => ({ ...row, rank: row.total ? index + 1 : null }));
}
