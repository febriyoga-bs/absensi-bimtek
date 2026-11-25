export function arrivedAtVenue(entry) {
  return entry.people?.some(person => ['selesai', 'sudah_tiba', 'sedang_antre'].includes(person.arrival_status)) || false;
}
