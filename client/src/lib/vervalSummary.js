export const progressBands = [
  ['0:25', '0–25%'], ['25.000001:50', '26–50%'], ['50.000001:75', '51–75%'],
  ['75.000001:94.999999', '76–94%'], ['95:100', '95–100%'], ['none', 'Belum ada data'],
];

export function summarizeSchools(schools) {
  const groups = { level: new Map(), program: new Map(), category: new Map(), progress: new Map(progressBands.map(([value]) => [value, 0])) };
  const add = (group, value) => group.set(value, (group.get(value) || 0) + 1);
  for (const school of schools) {
    add(groups.level, school.jenjang || '__missing__');
    add(groups.program, school.jenis_program || '__missing__');
    add(groups.category, school.kategori || '__missing__');
    const p = school.progres;
    const band = !Number.isFinite(p) ? 'none' : p <= 25 ? '0:25' : p <= 50 ? '25.000001:50'
      : p <= 75 ? '50.000001:75' : p < 95 ? '75.000001:94.999999' : '95:100';
    add(groups.progress, band);
  }
  return groups;
}
