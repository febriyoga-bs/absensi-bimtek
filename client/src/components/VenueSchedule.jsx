import { useState } from 'react';
import { bimtekSchedule } from '../lib/bimtekSchedule.js';
import Icon from './Icon.jsx';

export default function VenueSchedule({ info }) {
  const [stage, setStage] = useState(3);
  const schedule = bimtekSchedule.find((item) => item.stage === stage);
  // The current venue collection belongs to Tahap 3. Other stages remain empty
  // until their own venue data is supplied; never reuse Tahap 3 for another tab.
  const venues = info?.venues_by_stage?.[stage] || (stage === 3 ? info?.venues || [] : []);
  return <section className="panel venue-schedule" aria-labelledby="judul-venue">
    <h2 id="judul-venue" className="panel__title">Venue BIMTEK</h2>
    <div className="venue-stage-tabs" role="tablist" aria-label="Tahap venue BIMTEK">
      {bimtekSchedule.map((item, index) => <button key={item.stage} type="button" role="tab"
        id={`venue-stage-${item.stage}`} aria-selected={stage === item.stage} aria-controls="venue-stage-panel"
        tabIndex={stage === item.stage ? 0 : -1} onClick={() => setStage(item.stage)}
        onKeyDown={(event) => {
          let next;
          if (event.key === 'ArrowRight') next = (index + 1) % bimtekSchedule.length;
          if (event.key === 'ArrowLeft') next = (index + bimtekSchedule.length - 1) % bimtekSchedule.length;
          if (event.key === 'Home') next = 0;
          if (event.key === 'End') next = bimtekSchedule.length - 1;
          if (next == null) return;
          event.preventDefault(); setStage(bimtekSchedule[next].stage);
          event.currentTarget.parentElement.children[next].focus();
        }}>Tahap {item.stage}</button>)}
    </div>
    <div role="tabpanel" id="venue-stage-panel" aria-labelledby={`venue-stage-${stage}`}>
      <p className="muted small">BIMTEK Tahap {stage} · {schedule.dates}</p>
      {venues.length ? <div className="venues">
        {venues.map((venue) => <div key={venue.id || venue.name} className="venue-card">
          <span className="venue-card__icon"><Icon name="building" /></span>
          <span><b>{venue.name}</b>{venue.address && <small>{venue.address}</small>}</span>
        </div>)}
      </div> : <p className="venue-empty" role="status">{stage === 4
        ? 'Venue Tahap 4 belum diperbarui. Daftar venue akan ditampilkan setelah data tersedia.'
        : `Data venue Tahap ${stage} belum tersedia.`}</p>}
    </div>
  </section>;
}
