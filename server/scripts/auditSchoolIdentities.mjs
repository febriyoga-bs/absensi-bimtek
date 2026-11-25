import dotenv from 'dotenv';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
const [mappingFile,output='audit-school-identities.local.json']=process.argv.slice(2);
if (!mappingFile) throw new Error('Penggunaan: node server/scripts/auditSchoolIdentities.mjs <pemetaan.xlsx> [hasil.json]');
const require=createRequire(new URL('../../client/package.json',import.meta.url));
const {readSheet}=require('read-excel-file/node');
const [headers,...rows]=await readSheet(mappingFile,'Pemetaan Sekolah Final');
const index=name=>headers.indexOf(name);
const mapping=rows.filter(r=>r[index('NPSN')]).map(r=>({npsn:String(r[index('NPSN')]),name:r[index('Nama Sekolah')],venue:r[index('Hotel')],head_name:r[index('Nama Kepala Sekolah')]}));
dotenv.config({path:new URL('../.env',import.meta.url)});
const {auditSchoolIdentities}=await import('../src/auditSchoolIdentities.js');
const {rawPool,q}=await import('../src/db.js');
let schools,profiles=[],recaps=[],coverage,connectionError;
try {
  const {rows:[event]}=await rawPool.query('SELECT * FROM public.bimtek_events WHERE id=5');
  if (!event) throw new Error('Kegiatan PKS tidak ditemukan');
  const {eventContext}=await import('../src/eventContext.js');
  const {getSchoolArrivalStatuses}=await import('../src/arrivalRecap.js');
  await eventContext.run(event,async()=>{
    const {rows:[roster]}=await q("SELECT data->'schools' AS schools FROM assignment_roster WHERE id=1");
    schools=await getSchoolArrivalStatuses(roster.schools);
    profiles=(await q("SELECT p.id,p.name,p.npsn,p.position,p.venue_id,v.name AS venue FROM people p JOIN venues v ON v.id=p.venue_id WHERE p.archived_at IS NULL AND p.position IN ('Kepala Sekolah','Bendahara')")).rows;
    recaps=(await q('SELECT venue_id,marks,representatives FROM venue_arrival_recap')).rows;
  });
  coverage='Database aktif: profil dan tautan kedatangan';
} catch(error) {
  connectionError=error.code || error.message;
  const response=await fetch('http://localhost:5173/api/pks?event=5');
  if (!response.ok) throw new Error(`Data lokal gagal dimuat: ${response.status}`);
  const live=await response.json();
  schools=live.schools.map(s=>({...s,head_name:mapping.find(m=>m.npsn===String(s.npsn) && m.venue===s.venue)?.head_name || ''}));
  coverage='Data kedatangan API lokal + pemetaan Excel. Profil absensi privat belum dapat diaudit.';
} finally {await rawPool.end();}
const findings=auditSchoolIdentities(schools,profiles,recaps);
const report={created_at:new Date().toISOString(),coverage,connectionError,schools:schools.length,profiles:profiles.length,
  counts:Object.fromEntries([...new Set(findings.map(f=>f.type))].map(type=>[type,findings.filter(f=>f.type===type).length])),findings};
await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,findings:findings.slice(0,12)},null,2));
