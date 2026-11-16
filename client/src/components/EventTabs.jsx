import { useEvents } from './EventScope.jsx';
import './EventTabs.css';

export default function EventTabs({ children, current = true, onSelect }) {
  const scope = useEvents();
  if (!scope) return null;
  return <div className="reporting-datasets event-tabs" role="group" aria-label="Kegiatan BIMTEK">
    {[...scope.events].sort((a, b) => b.id - a.id).map((event) => <button key={event.id} type="button"
      className={current && event.id === scope.event.id ? 'on' : ''} aria-pressed={current && event.id === scope.event.id}
      onClick={() => {
        if (event.id === scope.event.id) onSelect?.();
        else scope.change(String(event.id));
      }}>{event.name}</button>)}
    {children}
  </div>;
}
