import { personName } from './personName.js';

export const loLabel = (value) => String(value ?? '').replace(/\blo\b/gi, 'LO');
export const attendanceFilename = (heading, extension) => `${loLabel(heading)
  .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '') || 'Rekap Absensi'}.${extension}`;

export function attendanceCell(header, value) {
  const text = String(value ?? '');
  if (header === 'Peran') return personName(text);
  if (header === 'Nama') return personName(text);
  if (['LO Bertugas', 'Diabsenkan oleh LO', 'LO Pencatat'].includes(header)) return text.split(';').map(personName).join('; ');
  if (['URL Foto', 'NPSN'].includes(header)) return text;
  return loLabel(text).replace(/((?:Diabsenkan|Dicatat) oleh LO\s+)([^;\r\n]+)/gi,
    (_, prefix, name) => prefix + personName(name));
}
