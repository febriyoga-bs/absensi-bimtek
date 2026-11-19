import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { periodStatusSql, parseProgressCsv } from '../src/progressImport.js';

test('period indicators distinguish missing, filled, complete and reviewed without implying approval',async()=>{
 const db=new PGlite();
 try{
  for(const [indicators,weekly,monthly] of [
   [{},'no_data','no_data'],
   [{'L3 Mingguan Terisi':'Belum','L5 Bulanan Terisi':'Sudah'},'not_filled','filled'],
   [{'L4 Mingguan Lengkap':'Sudah','R4 Bulanan Direviu':'Sudah'},'complete','reviewed'],
   [{'r3 mingguan lengkap direviu':'Sudah','R5 Bulanan Lengkap Direviu':'Sudah'},'reviewed_complete','reviewed_complete'],
  ]){
   const {rows:[row]}=await db.query(`SELECT ${periodStatusSql('pr','weekly')} AS weekly,${periodStatusSql('pr','monthly')} AS monthly FROM (VALUES($1::jsonb)) AS pr(indicators)`,[JSON.stringify(indicators)]);
   assert.deepEqual(row,{weekly,monthly});
  }
  const csv='NPSN,Capaian (%),L7 Capaian 50% Terisi,L8 Capaian 50% Terkirim,R6 Capaian 50% Direviu,L3 Mingguan Terisi,L5 Bulanan Terisi\n12345678,50,Sudah,Sudah,Belum,Sudah,Belum';
  const [row]=parseProgressCsv(csv);assert.equal(row.indicators['L3 Mingguan Terisi'],'Sudah');assert.equal(row.indicators['L5 Bulanan Terisi'],'Belum');
 }finally{await db.close();}
});
