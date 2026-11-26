import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseProgressExportSheets,parseProgressExport,progressExportUrl} from '../src/revitProgressExport.js';
import {progressLabels,progressScore} from '../../shared/pksProgress.js';
const columns=['No','Hotel','NPSN','Nama Sekolah','Kab/Kota','Verifikator','Koordinator','Program','Status Biodata',...progressLabels.slice(5,-1).map(p=>p[1])];
const row=(npsn,bio,flags)=>[1,'Atria Tangerang',npsn,'SD Test','Kab Test','Verifier','','SPAB',bio,...flags];
const summary=(count,pks=0,proposal=1)=>[['Hotel',...progressLabels.map(p=>p[1])],['Atria Tangerang',count,1,1,1,1,proposal,0,0,pks,0,0,0],['TOTAL',count,1,1,1,1,proposal,0,0,pks,0,0,0]];
test('export preserves independent achievements and calculates ten-stage scores',()=>{
 const data=parseProgressExportSheets(summary(1,1),[columns,row('12345678','Sudah verifikasi biodata',['Sudah','Belum','Belum','Sudah','Belum','Belum'])]);
 assert.equal(data.schools.length,1);assert.equal(data.schools[0].stage,'pks');
 assert.equal(progressScore(data.schools[0]),60);
 assert.deepEqual(data.schools[0].achieved,['login','bio_isi','bio_kirim','bio_ok','rab_kirim','pks']);
 assert.equal(data.metrics.find(m=>m.metric==='rab_kirim').value,1);
 assert.equal(new URL(progressExportUrl).searchParams.getAll('hotels[]').length,3);
});
test('multiple programs use the highest biodata stage and require every program for later milestones',()=>{
 const data=parseProgressExportSheets(summary(1,0,0),[columns,
 row('12345678','Sudah verifikasi biodata',['Sudah','Belum','Belum','Belum','Belum','Belum']),
 row('12345678','Belum login',['Belum','Belum','Belum','Belum','Belum','Belum'])]);
 assert.equal(data.schools.length,1);assert.equal(data.schools[0].stage,'bio_ok');
 assert.equal(data.schools[0].achieved.includes('rab_kirim'),false);
});
test('incomplete or malformed exports fail instead of replacing valid cached data',async()=>{
 assert.throws(()=>parseProgressExportSheets(summary(2),[columns,row('12345678','Belum login',Array(6).fill('Belum'))]),/seluruh/);
 assert.throws(()=>parseProgressExportSheets(summary(1),[columns.slice(0,4)]),/Kolom/);
 await assert.rejects(parseProgressExport(Buffer.from('<html>429</html>')),/tidak valid/);
});
