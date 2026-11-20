// Group only the assignments returned by the API, preserving its access scope.
export function groupPksVerifiers(assignments = []) {
  const groups = new Map();
  for (const row of assignments) {
    const key = JSON.stringify([row.venue, row.code || row.name]);
    if (!groups.has(key)) groups.set(key, { ...row, los: [] });
    const group = groups.get(key);
    if (row.lo && !group.los.includes(row.lo)) group.los.push(row.lo);
  }
  return [...groups.values()];
}
