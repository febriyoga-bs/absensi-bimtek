import { eventReportingDays } from './eventContext.js';
// Keep existing array consumers while resolving dates from the request context.
const dynamicArray = (values) => new Proxy([], { get(_target, key) {
  const array = values();
  const value = Reflect.get(array, key);
  return typeof value === 'function' ? value.bind(array) : value;
} });
export const reportingDays = dynamicArray(eventReportingDays);
export const reportingDates = dynamicArray(() => eventReportingDays().map((day) => day.date));
const wibDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' });

export function withReportingDay(session) {
  if (!session || session.is_test || !session.starts_at) return session;
  const date = wibDate.format(new Date(session.starts_at));
  const check_in_day = reportingDays.find((day) => day.date === date);
  return check_in_day ? { ...session, check_in_day } : session;
}

// Kelompokkan berdasarkan tanggal sesi dalam WIB, termasuk pengiriman yang tercatat setelah tengah malam.
export const reportingCheckInDates = (personId, venueId, dates) => `ARRAY(
  SELECT DISTINCT to_char(s.starts_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')
  FROM attendance a JOIN sessions s ON s.id=a.session_id AND NOT s.is_test
  WHERE a.person_id=${personId} AND a.venue_id=${venueId} AND a.status IN ('valid','review')
    AND (s.starts_at AT TIME ZONE 'Asia/Jakarta')::date=ANY(${dates}::date[])
)`;
