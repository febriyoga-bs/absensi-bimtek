import dotenv from 'dotenv';
import {readFile} from 'node:fs/promises';
dotenv.config({path:new URL('../.env',import.meta.url)});
const [file,mode]=process.argv.slice(2);
if (!file || (mode && mode!=='--apply')) throw new Error('Penggunaan: node server/scripts/correctSchoolArrival.mjs <koreksi.json> [--apply]');
const correction=JSON.parse(await readFile(file,'utf8'));
const {rawPool}=await import('../src/db.js');
try {
  const {rows:[event]}=await rawPool.query('SELECT * FROM public.bimtek_events WHERE id=$1',[correction.event_id]);
  if (!event || event.status==='archived') throw new Error('Kegiatan tidak tersedia atau diarsipkan.');
  const {eventContext}=await import('../src/eventContext.js');
  const {correctSchoolArrival}=await import('../src/correctSchoolArrival.js');
  console.log(await eventContext.run(event,()=>correctSchoolArrival(correction,{apply:mode==='--apply'})));
} catch(error) {console.error(error.code || error.message);process.exitCode=1;}
finally {await rawPool.end();}
