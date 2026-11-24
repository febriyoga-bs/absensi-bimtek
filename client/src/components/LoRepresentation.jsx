import {selectedEvent} from '../event.js';

export function loRepresentationLabel(name) {
  const key=String(name || '').trim().toLocaleLowerCase('id').replace(/\s+/g,' ');
  return selectedEvent()?.id === 5 && /^immanuel adhi pratama mar?turbongs$/.test(key) ? 'Diwakili Sista' : '';
}

export default function LoRepresentation({name}) {
  const label = loRepresentationLabel(name);
  return label ? <span className="lo-representation-tag">{label}</span> : null;
}
