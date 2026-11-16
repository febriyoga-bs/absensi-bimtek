let selected = null;
export const selectedEvent = () => selected;
export function setSelectedEvent(event) { selected = event; }
export function eventPath(path) {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  if (selected && !params.has('event')) params.set('event', selected.id);
  return `${base}${params.size ? `?${params}` : ''}`;
}
