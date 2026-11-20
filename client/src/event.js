let selected = null;
export const selectedEvent = () => selected;
export function setSelectedEvent(event) { selected = event; }
export function eventPath(path) {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  if (selected && !params.has('event')) params.set('event', selected.id);
  return `${base}${params.size ? `?${params}` : ''}`;
}

export function eventLabel(label) {
  return selected?.id === 5 ? String(label).replace(/Fasilitator/g, 'Verifikator').replace(/fasilitator/g, 'verifikator').replace(/Pengawas/g, 'Kepala Sekolah').replace(/Fasil Pelaporan/g, 'Verifikator').replace(/Koor Pelaporan/g, 'Koordinator') : label;
}
