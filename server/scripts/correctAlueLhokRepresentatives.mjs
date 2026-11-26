import dotenv from 'dotenv';
import {arrivalPersonKey as key} from '../../shared/pksAttendeeName.js';
dotenv.config({path:new URL('../.env',import.meta.url)});
const apply=process.argv.includes('--apply');
if(process.argv.slice(2).some(v=>v!=='--apply'))throw Error('Gunakan --apply untuk menyimpan.');
const {rawPool,pool}=await import('../src/db.js');
const {eventContext}=await import('../src/eventContext.js');
const {getSchoolArrivalStatuses}=await import('../src/arrivalRecap.js');
try{
 const {rows:[event]}=await rawPool.query('SELECT * FROM public.bimtek_events WHERE id=5');
 if(!event || event.status==='archived')throw Error('Kegiatan tidak tersedia.');
 await eventContext.run(event,async()=>{
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const {rows:[roster]}=await client.query('SELECT data FROM assignment_roster WHERE id=1 FOR UPDATE');
   const {rows:profiles}=await client.query(`SELECT p.id,p.name,p.position,p.venue_id FROM people p JOIN venues v ON v.id=p.venue_id
    WHERE p.npsn='10110573' AND v.name='Novotel Mangga Dua' AND p.archived_at IS NULL
    AND p.position IN ('Kepala Sekolah','Bendahara') FOR UPDATE OF p`);
   const head=profiles.find(p=>p.position==='Kepala Sekolah');
   if(profiles.length!==2 || !head || key(head.name)!==key('Suharto, S.Pd'))throw Error('Profil berbeda dari koreksi yang dikonfirmasi.');
   const {rows:[recap]}=await client.query('SELECT marks,representatives FROM venue_arrival_recap WHERE venue_id=$1 FOR UPDATE',[head.venue_id]);
   if(!recap)throw Error('Rekap belum tersedia.');
   const schools=await getSchoolArrivalStatuses(roster.data.schools,null,client.query.bind(client));
   const school=schools.find(s=>String(s.npsn)==='10110573');
   const source=(school?.arrival_attendees || []).find(p=>key(p.name)===key('Ismualim,S.Pd.I'));
   const second=(school?.arrival_attendees || []).find(p=>key(p.name)===key('Martoti'));
   const treasurer=profiles.find(p=>p.position==='Bendahara');
   if(!second || second.status!=='selesai' || !treasurer)throw Error('Perwakilan kedua tidak sesuai sumber.');
   if(!source || source.status!=='selesai')throw Error('Nama atau status sumber berubah; periksa kembali.');
   const existing=recap.representatives?.[head.id];
   if(existing?.name && key(existing.name)!==key(source.name))throw Error('Sudah ada perwakilan lain; koreksi dibatalkan.');
   const binding={name:source.name,original_name:head.name,role:'Perwakilan Sekolah',npsn:'10110573'};
   const secondBinding={name:second.name,original_name:treasurer.name,role:'Perwakilan Sekolah',npsn:'10110573'};
   const oldSecond=recap.representatives?.[treasurer.id];
   if(oldSecond?.name && key(oldSecond.name)!==key(second.name))throw Error('Profil kedua sudah memiliki perwakilan berbeda.');
   if(apply){
    await client.query(`UPDATE venue_arrival_recap SET marks=COALESCE(marks,'{}'::jsonb)||$1::jsonb,
     representatives=COALESCE(representatives,'{}'::jsonb)||$2::jsonb WHERE venue_id=$3`,
     [JSON.stringify({[head.id]:source.status,[treasurer.id]:second.status}),JSON.stringify({[head.id]:binding,[treasurer.id]:secondBinding}),head.venue_id]);
    const data={...roster.data,head_profile_correction_history:[...(roster.data.head_profile_correction_history || []),
     {corrected_at:new Date().toISOString(),npsn:'10110573',reason:'Konfirmasi pengguna: kepala sekolah tidak hadir, digantikan perwakilan sekolah.',
      before:{marks:recap.marks,representatives:recap.representatives},after:[binding,secondBinding]}]};
    await client.query('UPDATE assignment_roster SET data=$1 WHERE id=1',[JSON.stringify(data)]);
   }
   await client.query(apply?'COMMIT':'ROLLBACK');
   console.log(JSON.stringify({applied:apply,npsn:'10110573',representatives:[binding,secondBinding],status:source.status},null,2));
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 });
}catch(error){console.error(error.code || error.message);process.exitCode=1;}
finally{await rawPool.end();}
