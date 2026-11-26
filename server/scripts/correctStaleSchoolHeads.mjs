import dotenv from 'dotenv';
import {arrivalPersonKey as key} from '../../shared/pksAttendeeName.js';
import {pksSchoolHeadCorrections} from '../src/pksSchoolHeadCorrections.js';
dotenv.config({path:new URL('../.env',import.meta.url)});
const apply=process.argv.includes('--apply');
if(process.argv.slice(2).some(arg=>arg!=='--apply'))throw Error('Gunakan --apply untuk menyimpan.');
const {rawPool,pool}=await import('../src/db.js');
const {eventContext}=await import('../src/eventContext.js');
const {getSchoolArrivalStatuses,arrivalVenueKey}=await import('../src/arrivalRecap.js');
try {
 const {rows:[event]}=await rawPool.query('SELECT * FROM public.bimtek_events WHERE id=5');
 if(!event || event.status==='archived')throw Error('Kegiatan PKS tidak tersedia.');
 await eventContext.run(event,async()=>{
  const client=await pool.connect();
  try {
   await client.query('BEGIN');
   const {rows:[roster]}=await client.query('SELECT data FROM assignment_roster WHERE id=1 FOR UPDATE');
   const {rows:profiles}=await client.query(`SELECT p.id,p.name,p.npsn,p.venue_id,v.name AS venue
    FROM people p JOIN venues v ON v.id=p.venue_id WHERE p.role='peserta' AND p.archived_at IS NULL
    AND p.position='Kepala Sekolah' FOR UPDATE OF p`);
   const {rows:recaps}=await client.query('SELECT venue_id,marks,representatives FROM venue_arrival_recap FOR UPDATE');
   const schools=await getSchoolArrivalStatuses(roster.data.schools || [],null,client.query.bind(client));
   const changes=[];
   // These substitutions have explicitly been confirmed correct by the user.
   const preserve=new Set(['10102675','10305917','10303579']);
   for(const profile of profiles){
    const npsn=String(profile.npsn || '');
    const known=pksSchoolHeadCorrections[npsn];
    const recap=recaps.find(r=>r.venue_id===profile.venue_id);
    if(preserve.has(npsn) || !known?.previous || !recap || key(profile.name)!==key(known.previous)
      || key(known.previous)===key(known.name))continue;
    // Existing named representatives are intentional bindings, not stale names.
    if(recap.representatives?.[profile.id]?.name)continue;
    const school=schools.find(s=>String(s.npsn)===npsn && arrivalVenueKey(s.venue)===arrivalVenueKey(profile.venue));
    if(!school || key(school.head_name)!==key(known.name))continue;
    if(profiles.filter(p=>String(p.npsn)===npsn && p.venue_id===profile.venue_id).length!==1)continue;
    const sources=(school.arrival_attendees || []).filter(p=>key(p.name)===key(known.name));
    if(sources.length!==1)continue;
    const change={npsn,school:school.name,id:profile.id,before:profile.name,after:known.name,status:sources[0].status};
    changes.push(change);
    if(apply){
     await client.query('UPDATE people SET name=$1 WHERE id=$2',[known.name,profile.id]);
     await client.query(`UPDATE venue_arrival_recap SET marks=COALESCE(marks,'{}'::jsonb)||$1::jsonb WHERE venue_id=$2`,
      [JSON.stringify({[profile.id]:sources[0].status}),profile.venue_id]);
    }
   }
   if(apply && changes.length){
    const data={...roster.data,schools:roster.data.schools.map(s=>{
     const c=changes.find(c=>c.npsn===String(s.npsn));
     return c?{...s,head_name:c.after}:s;
    }),head_profile_correction_history:[...(roster.data.head_profile_correction_history || []),
     {corrected_at:new Date().toISOString(),reason:'Koreksi nama lama atas instruksi pengguna; perwakilan yang sudah benar dipertahankan.',changes}]};
    await client.query('UPDATE assignment_roster SET data=$1 WHERE id=1',[JSON.stringify(data)]);
   }
   await client.query(apply?'COMMIT':'ROLLBACK');
   console.log(JSON.stringify({applied:apply,count:changes.length,changes},null,2));
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 });
}catch(error){console.error(error.code || error.message);process.exitCode=1;}
finally{await rawPool.end();}
