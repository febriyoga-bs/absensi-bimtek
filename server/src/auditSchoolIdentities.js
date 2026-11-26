import {arrivalPersonKey} from '../../shared/pksAttendeeName.js';
import {arrivalVenueKey} from './arrivalRecap.js';
import {getSchoolArrivalStatuses} from './arrivalRecap.js';
import {pool} from './db.js';
import {eventId} from './eventContext.js';
import {HttpError} from './util.js';
import {schoolIdentity} from './schoolIdentity.js';

export async function getSchoolIdentityAudit() {
  if (eventId()!==5) throw new HttpError(400,'Audit identitas tersedia untuk kegiatan PKS SPAB.');
  // Use a read-only snapshot so an import cannot mix old profiles with new recap.
  const client=await pool.connect();
  let snapshot;
  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const {rows:[roster]}=await client.query('SELECT data FROM assignment_roster WHERE id=1');
    const {rows:profiles}=await client.query(`SELECT p.id,p.name,p.npsn,p.position,p.venue_id,v.name AS venue
      FROM people p JOIN venues v ON v.id=p.venue_id WHERE p.role='peserta' AND p.archived_at IS NULL
      AND p.position IN ('Kepala Sekolah','Bendahara')`);
    const {rows:recaps}=await client.query('SELECT venue_id,marks,representatives,detail_rows,imported_at::text AS imported_at FROM venue_arrival_recap');
    const schools=await getSchoolArrivalStatuses(roster?.data?.schools || [],null,client.query.bind(client));
    snapshot={schools,profiles,recaps};
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK');throw error;}
  finally {client.release();}
  const schools=snapshot.schools;
  const findings=auditSchoolIdentities(schools,snapshot.profiles,snapshot.recaps);
  const review_schools=[...new Set(findings.map(f=>f.npsn))].map(npsn=>{
    const school=schools.find(s=>String(s.npsn)===npsn);
    const profiles=snapshot.profiles.filter(p=>String(p.npsn)===npsn && arrivalVenueKey(p.venue)===arrivalVenueKey(school.venue));
    const recap=snapshot.recaps.find(r=>r.venue_id===profiles[0]?.venue_id);
    return {npsn,name:school.name,venue:school.venue,head_name:school.head_name,
      expected_imported_at:recap?.imported_at,
      profiles:profiles.map(p=>({...p,effective_name:recap?.representatives?.[p.id]?.name || p.name,arrival_status:recap?.marks?.[p.id] || 'belum_tercatat'})),
      source_rows:(recap?.detail_rows || []).filter(p=>schoolIdentity(p.institution)===schoolIdentity(school.name))
        .map(p=>({name:p.name,institution:p.institution,status:p.arrival_status || 'belum_tercatat'}))};
  });
  const dates=snapshot.recaps.map(r=>new Date(r.imported_at).getTime()).filter(Number.isFinite);
  return {created_at:new Date().toISOString(),event_id:eventId(),schools:schools.length,profiles:snapshot.profiles.length,
    imported_at:dates.length?new Date(Math.max(...dates)).toISOString():null,
    has_arrival_data:snapshot.recaps.length>0,
    affected_schools:new Set(findings.map(f=>f.npsn)).size,
    counts:Object.fromEntries([...new Set(findings.map(f=>f.type))].map(type=>[type,findings.filter(f=>f.type===type).length])),findings,review_schools};
}

// Read-only audit: flags evidence for review and never changes attendance.
export function auditSchoolIdentities(schools, profiles=[], recaps=[]) {
  const findings=[];
  for (const school of schools) {
    const candidates=profiles.filter(p=>String(p.npsn)===String(school.npsn)
      && arrivalVenueKey(p.venue)===arrivalVenueKey(school.venue));
    const head=arrivalPersonKey(school.head_name);
    const add=(type,evidence)=>findings.push({type,npsn:String(school.npsn),school:school.name,
      venue:school.venue,head_name:school.head_name || '',evidence});
    const effective=candidates.map(p=>{
      const recap=recaps.find(r=>r.venue_id===p.venue_id);
      return {...p,effective_name:recap?.representatives?.[p.id]?.name || p.name,
        arrival_status:recap?.marks?.[p.id] || null};
    });
    const byName=new Map();
    for (const p of effective) {
      const name=arrivalPersonKey(p.effective_name);
      if (!name || /^(bendahara|kepalasekolah)/.test(name)) continue;
      if (!byName.has(name)) byName.set(name,[]);
      byName.get(name).push(p);
      if (head && name===head && p.position==='Bendahara') add('HEAD_ON_TREASURER',`${p.effective_name} tertaut ke profil Bendahara (ID ${p.id}).`);
    }
    for (const rows of byName.values()) if (rows.length>1) add('DUPLICATE_PROFILE_NAME',
      `${rows[0].effective_name}: ${rows.map(p=>`${p.position} ID ${p.id}`).join('; ')}.`);
    const arrivals=school.arrival_attendees || [];
    for (const profile of effective) {
      const source=arrivals.filter(p=>arrivalPersonKey(p.name)===arrivalPersonKey(profile.effective_name) && p.role===profile.position);
      if (source.length===1 && ['selesai','sudah_tiba','sedang_antre'].includes(source[0].status)
        && !['selesai','sudah_tiba','sedang_antre'].includes(profile.arrival_status)) {
        add('SOURCE_PROFILE_ARRIVAL_MISMATCH',`${profile.effective_name} (${profile.position}): rekap ${source[0].status}, profil ${profile.arrival_status || 'belum_tercatat'}.`);
      }
    }
    if (school.arrival_identity_ambiguous) add('AMBIGUOUS_SCHOOL_NAME',
      'Nama sekolah dan venue sama untuk beberapa NPSN. Baris sumber tanpa NPSN tidak digabungkan; perlu konfirmasi sekolah tujuan.');
    const sourceHead=arrivals.filter(p=>head && arrivalPersonKey(p.name)===head);
    if (sourceHead.some(p=>p.role!=='Kepala Sekolah')) add('SOURCE_HEAD_ROLE',
      sourceHead.map(p=>`${p.name}: ${p.role}, ${p.status}`).join('; '));
    if (arrivals.length && !sourceHead.length && !arrivals.some(p=>p.role==='Kepala Sekolah')) {
      add('UNRESOLVED_HEAD_IDENTITY',`Pemetaan: ${school.head_name || '(nama kosong)'}. Rekap: ${arrivals.map(p=>`${p.name} (${p.status})`).join('; ')}. Bisa pergantian kepala sekolah atau perwakilan; belum terbukti salah.`);
    }
    const arrivedNames=arrivals.filter(p=>['selesai','sudah_tiba','sedang_antre'].includes(p.status));
    if (arrivedNames.length>2) add('MORE_THAN_TWO_SOURCE_NAMES',`${arrivedNames.length} nama sudah tiba/antre pada sekolah ini; perlu memeriksa sumber dan identitas.`);
  }
  return findings;
}
