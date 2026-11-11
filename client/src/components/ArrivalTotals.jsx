import FontIcon from './FontIcon.jsx';
import ArrivalBreakdown from './ArrivalBreakdown.jsx';

const number = new Intl.NumberFormat('id-ID');
const metrics = [
  ['invited', 'Undangan', 'users'],
  ['arrived', 'Sudah tiba', 'circle-check'],
  ['queued', 'Sedang antre', 'clock'],
];

export default function ArrivalTotals({ venues }) {
  if (!venues.length) return null;

  const byPosition = new Map();
  for (const venue of venues) {
    for (const row of venue.breakdown || []) {
      const total = byPosition.get(row.position) || { position: row.position, invited: 0, arrived: 0, queued: 0 };
      for (const [key] of metrics) total[key] += row[key];
      byPosition.set(row.position, total);
    }
  }
  const breakdown = [...byPosition.values()].sort((a, b) => a.position.localeCompare(b.position, 'id'));

  return <section className="venue-attendance arrival-totals" aria-label="Ringkasan seluruh venue">
    <h3>Ringkasan seluruh venue</h3>
    <dl className="venue-attendance__groups arrival-venue-metrics public-arrival-metrics">
      {metrics.map(([key, label, icon]) => <div key={key} className={`arrival-metric--${key}`}>
        <dt className="arrival-metric__label">{label}</dt>
        <dd className="arrival-metric__value"><FontIcon name={icon} />
          <b>{number.format(venues.reduce((sum, venue) => sum + venue[key], 0))}</b>
        </dd>
      </div>)}
    </dl>
    <ArrivalBreakdown rows={breakdown} />
  </section>;
}
