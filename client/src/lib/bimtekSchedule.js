export const bimtekSchedule = [
  { stage: 4, dates: '16–21 November 2026', startsOn: '2026-11-16', endsOn: '2026-11-21' },
  { stage: 3, dates: '9–14 November 2026', startsOn: '2026-11-09', endsOn: '2026-11-14' },
  { stage: 2, dates: '3–8 November 2026', startsOn: '2026-11-03', endsOn: '2026-11-08' },
];

export const reportingDates = { current: bimtekSchedule[1].dates, k3: bimtekSchedule[2].dates };

const wibDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function currentAndUpcomingBimtek(now = new Date()) {
  const today = wibDate.format(now);
  return bimtekSchedule.filter((item) => item.endsOn >= today)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}
