// Group only the assignments returned by the API, preserving its access scope.
export function groupPksVerifiers(assignments = [], schools = []) {
  const groups = new Map();
  for (const row of assignments) {
    const key = JSON.stringify([row.venue, row.code || row.name]);
    if (!groups.has(key)) groups.set(key, { ...row, los: [] });
    const group = groups.get(key);
    if (row.lo && !group.los.includes(row.lo)) group.los.push(row.lo);
  }
  const nameKey = value => String(value || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  for (const group of groups.values()) {
    const same = assignments.filter(row => row.venue === group.venue && (group.code ? row.code === group.code : nameKey(row.name) === nameKey(group.name)));
    const mapped = schools.filter(row => row.venue === group.venue && nameKey(row.facilitator) === nameKey(group.name));
    for (const field of ['phone','email','coordinator_phone','coordinator_email']) {
      if (group[field]) continue;
      const schoolField = field.startsWith('coordinator_') ? field : `facilitator_${field}`;
      const values = [...new Set([...same.map(row => row[field]), ...mapped
        .filter(row => !field.startsWith('coordinator_') || nameKey(row.coordinator) === nameKey(group.coordinator))
        .map(row => row[schoolField])].filter(Boolean))];
      if (values.length === 1) group[field] = values[0];
    }
  }
  return [...groups.values()];
}
