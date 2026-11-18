import {createHash} from 'node:crypto';
const key=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export async function ensureOrganizationProfiles(query){
 const {rows:[roster]}=await query('SELECT data FROM assignment_roster WHERE id=1 FOR UPDATE');
 const {rows:venues}=await query('SELECT id,name FROM venues');
 const {rows:people}=await query('SELECT code,role,position,institution,venue_id,archived_at FROM people');
 const missing=[],seen=new Set();
 for(const row of roster?.data.organizations||[]){
  const venue=venues.find(v=>v.name===row.venue);
  if(!venue||!['Dinas Pendidikan','BB/BPMP'].includes(row.position)||!row.institution)throw new Error(`Pemetaan instansi tidak valid: ${row.institution}`);
  const identity=`${venue.id}:${row.position}:${key(row.institution)}`;
  if(seen.has(identity))continue;seen.add(identity);
  const matches=people.filter(p=>p.venue_id===venue.id&&p.position===row.position&&key(p.institution)===key(row.institution));
  if(matches.length>1||matches.some(p=>p.role!=='peserta'||p.archived_at))throw new Error(`Profil instansi perlu diperiksa: ${row.institution}`);
  if(matches.length)continue;
  const code=(row.position==='Dinas Pendidikan'?'DINAS':'BPMP')+'-'+createHash('sha256').update(identity).digest('hex').slice(0,12).toUpperCase();
  if(people.some(p=>p.code.toLowerCase()===code.toLowerCase()))throw new Error(`Kode instansi sudah digunakan: ${row.institution}`);
  missing.push({...row,code,venue_id:venue.id});
 }
 if(missing.length)await query(`INSERT INTO people(code,name,role,position,venue_id,institution,kab_kota,provinsi,roster_added_at)
 SELECT code,institution,'peserta',position,venue_id,institution,kab_kota,provinsi,now()
 FROM jsonb_to_recordset($1::jsonb) x(code text,position text,venue_id int,institution text,kab_kota text,provinsi text)`,[JSON.stringify(missing)]);
 return {created:missing.length,total:seen.size,by_position:missing.reduce((a,p)=>(a[p.position]=(a[p.position]||0)+1,a),{})};
}
