import test from 'node:test';
import assert from 'node:assert/strict';
import { readMonitoringCsv, parseArrivalSheets } from './reportingFiles.js';

const csvFile = (text) => ({ size: new TextEncoder().encode(text).length, text: async () => text });

test('arrival parser skips new sections without losing regional rows or duplicate hotels', () => {
  const details = [['Regional / Hotel','Role','Nama','Instansi','Kedatangan'],['Lumire Jakarta','Sekolah','A','SD A','Selesai']];
  const header = ['No','Regional / Hotel'];
  const data = (n,arrived=0) => [1,'Lumire Jakarta',n,0,0,0,0,`${arrived} (0%)`,0];
  const result = parseArrivalSheets(details,[['Sekolah'],header,['Jakarta'],data(250,200),data(54),['Perencana'],header,data(999),['Pengawas'],header,data(100,75),['Dinas Pendidikan'],header,data(34,20)]);
  assert.deepEqual(result.summary.map(r=>[r.position,r.invited]),[['Bendahara',250],['Bendahara',54],['Pengawas',100],['Dinas Pendidikan',34]]);
  assert.equal(result.summary[0].arrived,200);
});

test('progress import reports stages and sends only required columns', async () => {
  const stages = [];
  const csv = await readMonitoringCsv(csvFile('NPSN,Capaian (%),L7 Capaian 50% Terisi,L8 Capaian 50% Terkirim,R6 Capaian 50% Direviu,NIK,Telepon\n12345678,50,Sudah,Sudah,Belum,private-id,private-phone'), (stage) => stages.push(stage));
  assert.deepEqual(stages, ['reading', 'validating']);
  assert.match(csv, /12345678,50,Sudah,Sudah,Belum/);
  assert.doesNotMatch(csv, /NIK|Telepon|private/);
});

test('official review CSV retains supported contact fields and removes unrelated data', async () => {
  const csv = await readMonitoringCsv(csvFile('NPSN,Status Reviu,Tanggal Kirim,Capaian Saat Ini (%),Fasilitator,No. HP Fasilitator,NIK\n12345678,diterima_fasil,12/11/2026,50,Fasil A,081234567890,private-id'));
  assert.match(csv, /Fasil A,081234567890/);
  assert.doesNotMatch(csv, /NIK|private-id/);
});

test('compact status CSV remains unchanged', async () => {
  const text = 'npsn,status,tanggal_kirim,progres_fisik\n12345678,belum_kirim,,50';
  assert.equal(await readMonitoringCsv(csvFile(text)), text);
});

test('monitoring with an L8 indicator takes precedence over progress detection', async () => {
  const csv = await readMonitoringCsv(csvFile('NPSN,Status Reviu,Tanggal Kirim,Capaian Saat Ini (%),L8 Capaian 50% Terkirim\n12345678,diterima_fasil,12/11/2026,75,Sudah'));
  assert.match(csv, /status reviu/);
  assert.match(csv, /diterima_fasil/);
  assert.doesNotMatch(csv, /l8 capaian/i);
});

test('monitoring with both complete schemas still preserves review outcomes', async () => {
  const csv = await readMonitoringCsv(csvFile('NPSN,Status Reviu,Tanggal Kirim,Capaian Saat Ini (%),Capaian (%),L7 Capaian 50% Terisi,L8 Capaian 50% Terkirim,R6 Capaian 50% Direviu\n12345678,dikembalikan_fasil,12/11/2026,75,75,Sudah,Sudah,Sudah'));
  assert.match(csv, /dikembalikan_fasil/);
  assert.match(csv, /tanggal kirim/);
  assert.doesNotMatch(csv, /l8 capaian/i);
});

test('incomplete progress files fail before upload', async () => {
  await assert.rejects(readMonitoringCsv(csvFile('NPSN,L8 Capaian 50% Terkirim\n12345678,Sudah')), /Kolom CSV Progres Laporan Sekolah tidak lengkap/);
});

test('oversized files fail before reading', async () => {
  await assert.rejects(readMonitoringCsv({ size: 20_000_001, text: () => { throw new Error('must not read'); } }), /maksimal 20 MB/);
});
