import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { selectedEvent } from '../event.js';
import './EventTabs.css';
import { venueSchedulesFor } from '../lib/bimtekSchedule.js';
import Icon from './Icon.jsx';

export default function VenueSchedule({ info }) {
  const schedules = venueSchedulesFor(selectedEvent());
  const [requestedStage, setStage] = useState(selectedEvent()?.id || schedules[0].stage);
  const schedule = schedules.find(item => item.stage === requestedStage) || schedules[0];
  const stage = schedule.stage;
  const activityName = schedule.name || `BIMTEK Tahap ${stage}`;
  const [loaded, setLoaded] = useState({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (stage === 2) { setLoading(false); setError(''); return; }
    let live = true;
    setLoading(true); setError('');
    api(`/info?event=${stage}`).then((data) => { if (live) setLoaded((old) => ({ ...old, [stage]: Array.isArray(data.venues) ? data.venues : [] })); })
      .catch((e) => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [stage]);
  const venues = loaded[stage] || (info?.event?.id === stage && Array.isArray(info.venues) ? info.venues : []);
  return <section className="panel venue-schedule" aria-labelledby="judul-venue">
    <h2 id="judul-venue" className="panel__title">Venue BIMTEK</h2>
    <div className="reporting-datasets event-tabs venue-stage-tabs" role="tablist" aria-label="Tahap venue BIMTEK">
      {schedules.map((item, index) => <button key={item.stage} type="button" role="tab"
        id={`venue-stage-${item.stage}`} className={stage === item.stage ? 'on' : ''} aria-selected={stage === item.stage} aria-controls="venue-stage-panel"
        tabIndex={stage === item.stage ? 0 : -1} onClick={() => setStage(item.stage)}
        onKeyDown={(event) => {
          let next;
          if (event.key === 'ArrowRight') next = (index + 1) % schedules.length;
          if (event.key === 'ArrowLeft') next = (index + schedules.length - 1) % schedules.length;
          if (event.key === 'Home') next = 0;
          if (event.key === 'End') next = schedules.length - 1;
          if (next == null) return;
          event.preventDefault(); setStage(schedules[next].stage);
          event.currentTarget.parentElement.children[next].focus();
        }}>{item.tabLabel || `Tahap ${item.stage}`}</button>)}
    </div>
    <div role="tabpanel" id="venue-stage-panel" aria-labelledby={`venue-stage-${stage}`}>
      <p className="muted small">{activityName}{schedule.dates ? ` · ${schedule.dates}` : ''}</p>
      {loading && <p role="status" className="muted small">Memuat venue…</p>}
      {error && <p role="alert" className="alert alert--err">{error}</p>}
      {venues.length ? <div className="venues">
        {venues.map((venue) => <div key={venue.id || venue.name} className="venue-card">
          <span className="venue-card__icon"><Icon name="building" /></span>
          <span><b>{venue.name}</b>{venue.address && <small>{venue.address}</small>}</span>
        </div>)}
      </div> : !loading && !error && <p className="venue-empty" role="status">{stage === 4
        ? 'Venue Tahap 4 belum diperbarui. Daftar venue akan ditampilkan setelah data tersedia.'
        : `Data venue ${activityName} belum tersedia.`}</p>}
    </div>
  </section>;
}
