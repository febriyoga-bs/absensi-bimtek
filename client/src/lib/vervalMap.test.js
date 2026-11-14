import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clusterSchools, hasCoordinates, matchesSchool, schoolGeoJSON } from './vervalMap.js';

test('markers and exports omit missing, zero, and out-of-Indonesia coordinates', () => {
  const rows = [
    { npsn: 'a', lat: -7.9, lng: 110.3 }, { npsn: 'b', lat: null, lng: 110.3 },
    { npsn: 'c', lat: 0, lng: 0 }, { npsn: 'd', lat: 90, lng: 110 }, { npsn: 'e', lat: 0, lng: 120 },
  ];
  assert.deepEqual(rows.filter(hasCoordinates).map((row) => row.npsn), ['a', 'e']);
  const geo = schoolGeoJSON(rows);
  assert.deepEqual(geo.features[0].geometry.coordinates, [110.3, -7.9]);
  assert.equal(geo.features.length, 2);
});

test('progress filtering preserves real zero and distinguishes missing progress', () => {
  assert.equal(matchesSchool({ progres: 0 }, { progress: '0:25' }), true);
  assert.equal(matchesSchool({ progres: null }, { progress: '0:25' }), false);
  assert.equal(matchesSchool({ progres: null }, { progress: 'none' }), true);
  assert.equal(matchesSchool({ progres: 50.5 }, { progress: '50.000001:75' }), true);
  assert.equal(matchesSchool({ progres: 95 }, { progress: '75.000001:94.999999' }), false);
});

test('school search and geographic filters combine without modifying source rows', () => {
  const school = { nama: 'SD Negeri SRUNGGO', npsn: '20400119', kode_kab: '34.02', kategori: 'Reguler', jenis_program: 'REVIT', tahun: 2026, status_sekolah: 'Negeri' };
  assert.equal(matchesSchool(school, { search: ' srunggo ', district: '34.02', year: '2026' }), true);
  assert.equal(matchesSchool(school, { search: '20400119', district: '34.01' }), false);
  assert.equal(matchesSchool(school, { program: 'USB' }), false);
});

test('clustering conserves schools and keeps coincident markers selectable', () => {
  const schools = [
    { npsn: 'a', lat: -7, lng: 110 }, { npsn: 'b', lat: -7, lng: 110 }, { npsn: 'c', lat: -8, lng: 120 },
  ];
  const result = clusterSchools(schools, (lat, lng) => ({ x: lng * 100, y: lat * 100 }), 30);
  assert.equal(result.length, 2);
  assert.equal(result.reduce((sum, cluster) => sum + cluster.count, 0), schools.length);
  assert.deepEqual(result[0].schools.map((school) => school.npsn), ['a', 'b']);
});

test('local boundary GeoJSON includes 38 valid province codes and closed WGS84 rings', async () => {
  const boundaries = JSON.parse(await readFile(new URL('../../public/geo/indonesia-provinces.geojson', import.meta.url)));
  assert.equal(boundaries.features.length, 38);
  assert.equal(new Set(boundaries.features.map((feature) => feature.properties.code)).size, 38);
  for (const feature of boundaries.features) {
    assert.match(feature.properties.code, /^\d{2}$/);
    for (const polygon of feature.geometry.coordinates) {
      for (const ring of polygon) {
        assert.ok(ring.length >= 4);
        assert.deepEqual(ring[0], ring.at(-1));
        for (const [lng, lat] of ring) assert.ok(lng > 94 && lng < 142 && lat > -12 && lat < 7);
      }
    }
  }
});
