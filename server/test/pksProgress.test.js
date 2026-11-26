import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressStages, progressStage, hasProgressStage, progressScore, progressLabels } from '../../shared/pksProgress.js';
import { parseProgressPage, parseProgressSchoolPage } from '../src/pksProgressSource.js';

test('ten achieved stages share scoring and support incomplete multi-program achievements', () => {
  assert.equal(progressStages.length, 10);
  assert.equal(progressScore('belum_login'), 0);
  assert.equal(progressScore('meterai'), 100);
  assert.equal(progressStage('3. Sudah kirim biodata'), 'bio_kirim');
  assert.equal(progressStage('Menunggu verifikasi biodata'), 'bio_kirim');
  const status = { stage: 'pks', achieved: ['login', 'bio_isi', 'bio_kirim', 'bio_ok', 'pks'] };
  assert.equal(hasProgressStage(status, 'login'), true);
  assert.equal(hasProgressStage(status, 'sepakat_rab'), false);
  assert.equal(progressScore(status), 5 * 100 / 10);
  assert.equal(progressScore('tidak_terdata'), null);
});

test('source metric identifiers are preserved while labels map ten cumulative columns', () => {
  const labels = progressLabels;
  const cards = labels.map(([key, label], i) => `<button data-progress-open data-hotel="" data-metric="source_${i}"><span>${label}</span><strong>${i === 0 ? '1.433' : i}</strong></button>`).join('');
  const cells = labels.map((_, i) => `<td><button data-metric="source_${i}">${i === 0 ? '542' : i}</button></td>`).join('');
  const html = `${cards}<table><tr class="hover:bg-soft"><td>Atria Tangerang</td>${cells}</tr></table>`;
  const result = parseProgressPage(html);
  assert.equal(result.metrics.length, 12);
  assert.equal(result.metrics.find(x => x.metric === 'login').sourceMetric, 'source_1');
  assert.equal(result.hotels[0].metrics.total, 542);
  assert.equal(result.hotels[0].metrics.bio_kirim, 3);
  assert.equal(result.metrics[0].value, 1433);
});

test('school popup retains NPSN identity for stage membership', () => {
  const result = parseProgressSchoolPage('<tr><td>SD A NPSN 10102061</td><td>Aceh</td><td>Atria</td><td>Sudah kirim biodata</td></tr>');
  assert.equal(result.rows[0].npsn, '10102061');
  assert.equal(progressStage(result.rows[0].status), 'bio_kirim');
});

test('new verifier and LO columns do not become school status', () => {
  const result = parseProgressSchoolPage('<tr><td>SD A NPSN 10102061</td><td>Aceh</td><td>Atria</td><td>Verifier Name</td><td>LO Name</td><td>Sudah kirim biodata</td><td>Sudah tiba</td></tr>');
  assert.equal(result.rows[0].status, 'Sudah kirim biodata');
  assert.equal(progressStage(result.rows[0].status), 'bio_kirim');
});

test('proposal RAB is the fifth of ten stages',()=>{
 assert.equal(progressStage('Sudah verifikasi biodata Kirim proposal RAB'),'rab_kirim');
 assert.equal(progressScore('rab_kirim'),50);
 assert.equal(progressScore('bio_ok'),40);
 assert.equal(hasProgressStage({stage:'rab_kirim',achieved:['bio_ok']},'rab_kirim'),false);
});

test('Revit counts biodata in progress as the filled biodata stage',()=>{assert.equal(progressStage('Proses mengisi biodata'),'bio_isi');assert.equal(progressScore(progressStage('Proses mengisi biodata')),20);});
