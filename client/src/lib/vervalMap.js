export const indonesiaBounds = [[-11.2, 94.8], [6.3, 141.2]];
export const levelColors = { PAUD: '#38bdf8', SD: '#ef4444', SMP: '#2563eb', SMA: '#8b5cf6', SMK: '#f59e0b', SLB: '#22c55e', PNFI: '#475569' };
export const provinceColors = ['#c7e5cf', '#f5d4c2', '#cedff2', '#e9d4ed', '#f2e2ad', '#cce7e5'];

export function hasCoordinates(school) {
  return Number.isFinite(school.lat) && Number.isFinite(school.lng)
    && school.lat >= -11.2 && school.lat <= 6.3 && school.lng >= 94.8 && school.lng <= 141.2;
}

export function schoolGeoJSON(schools) {
  return { type: 'FeatureCollection', features: schools.filter(hasCoordinates).map((school) => ({
    type: 'Feature', id: school.npsn, geometry: { type: 'Point', coordinates: [school.lng, school.lat] },
    properties: school,
  })) };
}

export function matchesSchool(school, { search, district, category, program, progress, year, status }) {
  if (district && school.kode_kab !== district) return false;
  if (category && school.kategori !== category) return false;
  if (program && school.jenis_program !== program) return false;
  if (year && String(school.tahun) !== year) return false;
  if (status && school.status_sekolah !== status) return false;
  if (progress) {
    if (!Number.isFinite(school.progres)) return progress === 'none';
    if (progress === 'none') return false;
    const [min, max] = progress.split(':').map(Number);
    if (school.progres < min || school.progres > max) return false;
  }
  return !search || `${school.nama} ${school.npsn} ${school.desa} ${school.kecamatan}`.toLocaleLowerCase('id').includes(search.trim().toLocaleLowerCase('id'));
}

export function clusterSchools(schools, project, size) {
  const groups = new Map();
  for (const school of schools) {
    if (!hasCoordinates(school)) continue;
    const point = project(school.lat, school.lng);
    const key = `${Math.floor(point.x / size)}:${Math.floor(point.y / size)}`;
    const group = groups.get(key) || { count: 0, lat: 0, lng: 0, school, schools: [] };
    group.schools.push(school);
    group.count += 1; group.lat += school.lat; group.lng += school.lng;
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({ ...group, lat: group.lat / group.count, lng: group.lng / group.count }));
}
