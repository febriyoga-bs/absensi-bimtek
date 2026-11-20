export const pksDayLabels = {
  '2026-11-23': 'Kedatangan Panitia',
  '2026-11-24': 'Kedatangan Peserta',
  '2026-11-25': 'Hari 1',
  '2026-11-26': 'Hari 2',
  '2026-11-27': 'Penutupan',
};

export const pksSessions = [
  ['24', 'panitia'], ['25', 'panitia'], ['25', 'peserta'],
  ['26', 'panitia'], ['26', 'peserta'], ['27', 'panitia'],
].map(([day, role]) => {
  const date = `2026-11-${day}`;
  const panitia = role === 'panitia';
  return { name: `${pksDayLabels[date]} · Absensi ${panitia ? 'Panitia' : 'Peserta'}`,
    role, type: 'Sesi Absensi', starts_at: `${date}T${panitia ? '05' : '08'}:00:00+07:00`,
    ends_at: `${date}T${panitia ? '08' : '23'}:00:00+07:00` };
});

export async function insertPksSchedule(query) {
  for (const session of pksSessions) await query(
    'INSERT INTO sessions(name,role,type,starts_at,ends_at) VALUES($1,$2,$3,$4,$5)',
    [session.name, session.role, session.type, session.starts_at, session.ends_at]);
}
