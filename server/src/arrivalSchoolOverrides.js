const key = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Confirmed correction for one source participant; equal school names alone
// never identify a school across different NPSNs.
export function arrivalSchoolOverride(row) {
  if (key(row.venue).replace(/^hotel/, '') === 'atriatangerang'
    && key(row.name) === 'mardianriochandrahadinatalubis'
    && key(row.institution) === 'uptdsdnegeri153003hudopanauuli1') return '10206644';
  return null;
}

// Current head confirmed against the user's school mapping, keyed by NPSN.
export function schoolHeadOverride(npsn) {
  return String(npsn) === '10101744' ? 'Ramatsyah' : null;
}
