import {selectedEvent} from '../event.js';

export default function LoRepresentation({name}) {
  const key=String(name || '').trim().toLocaleLowerCase('id').replace(/\s+/g,' ');
  if (selectedEvent()?.id!==5 || key!=='immanuel adhi pratama maturbongs') return null;
  return <span className="lo-representation-tag">Diwakili Sista</span>;
}
