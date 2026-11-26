import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRevitJsonPages, loadRevitProgressJson } from '../src/revitProgressJson.js';

const row = (npsn, reached) => ({
  npsn, nama: 'SD Contoh', kabkota: 'Bandung', hotel: 'Atria Tangerang',
  reached, metrics: [], owners: { biodata: { name: 'Verifier' } },
});
const page = (version, schools, last_page = 2) => ({
  version, last_page, schools, labels: { bio_ok: 'Sudah verifikasi biodata' },
});

test('JSON export combines pages and computes ten stages for schools and venues', () => {
  const data = parseRevitJsonPages([
    page('v1', [row('10102061', ['login', 'bio_isi', 'bio_kirim', 'bio_ok', 'kirim_rab'])]),
    page('v1', [row('10102062', ['login'])]),
  ]);
  assert.equal(data.schools.length, 2);
  assert.equal(data.schools[0].stage, 'rab_kirim');
  assert.deepEqual(data.schools[0].achieved, ['login', 'bio_isi', 'bio_kirim', 'bio_ok', 'rab_kirim']);
  assert.equal(data.hotels[0].metrics.bio_ok, 1);
  assert.equal(data.metrics.find(item => item.metric === 'login').value, 2);
  assert.equal(data.schools[0].verifier, 'Verifier');
});

test('JSON export rejects a mixed version or duplicate school', () => {
  assert.throws(() => parseRevitJsonPages([page('v1', []), page('v2', [])]));
  assert.throws(() => parseRevitJsonPages([
    page('v1', [row('10102061', [])]), page('v1', [row('10102061', [])]),
  ]));
});

test('loader retries when the first export pages have different versions', async () => {
  let requests = 0;
  const data = await loadRevitProgressJson({ read: async url => {
    requests++;
    const pageNo = Number(new URL(url).searchParams.get('page'));
    return JSON.stringify(page(requests <= 2 ? `v${pageNo}` : 'v3',
      [row(pageNo === 1 ? '10102061' : '10102062', ['login'])]));
  } });
  assert.equal(requests, 4);
  assert.equal(data.schools.length, 2);
});
