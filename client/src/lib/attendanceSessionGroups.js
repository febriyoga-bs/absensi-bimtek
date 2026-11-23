export function attendanceSessionGroups(groups, roles = []) {
  if (!roles.length || roles.some(role => !['peserta', 'panitia'].includes(role))) return groups;
  return groups.filter(([key]) => roles.includes(key === 'lo' ? 'panitia' : 'peserta'));
}

export function attendanceSessionTarget(session, venues, groups) {
  const applicable = attendanceSessionGroups(groups, [session.role]);
  return venues.filter(venue => !session.venue_ids?.length || session.venue_ids.includes(venue.id))
    .reduce((sum, venue) => sum + applicable.reduce((count, [key]) => count + (venue[key]?.total || 0), 0), 0);
}
