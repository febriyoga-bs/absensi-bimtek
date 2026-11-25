import {pool} from './db.js';
import {eventId} from './eventContext.js';
import {arrivalVenueKey} from './arrivalRecap.js';
import {unifiedStorage} from './unifiedStorage.js';

// Explicit administrative data correction. The snapshot is retained for audit;
// Session payloads move only when an explicit, validated swap is requested.
export async function correctSchoolArrival(correction, {apply=false}={}) {
  if (eventId() !== correction.event_id || !/^\d{8}$/.test(correction.npsn)
    || !correction.reason || !correction.head_name || correction.attendees?.length !== 2
    || !['Kepala Sekolah','Bendahara'].every(role=>correction.attendees.some(p=>p.role===role))) {
    throw new Error('Data koreksi atau kegiatan tidak valid.');
  }
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const {rows:[roster]}=await client.query('SELECT data FROM assignment_roster WHERE id=1 FOR UPDATE');
    const schools=roster?.data?.schools || [];
    const school=schools.find(s=>String(s.npsn)===correction.npsn && arrivalVenueKey(s.venue)===arrivalVenueKey(correction.venue));
    if (!school) throw new Error('Sekolah dan venue koreksi tidak ditemukan.');
    const {rows:profiles}=await client.query(`SELECT p.id,p.name,p.position,p.venue_id FROM people p
      JOIN venues v ON v.id=p.venue_id WHERE p.npsn=$1 AND v.name=$2 AND p.role='peserta'
      AND p.archived_at IS NULL AND p.position IN ('Kepala Sekolah','Bendahara') FOR UPDATE OF p`,[correction.npsn,school.venue]);
    if (profiles.length !== 2 || new Set(profiles.map(p=>p.position)).size !== 2) throw new Error('Harus ada tepat satu profil kepala sekolah dan satu bendahara.');
    const {rows:[recap]}=await client.query('SELECT marks,representatives,imported_at::text AS imported_at FROM venue_arrival_recap WHERE venue_id=$1 FOR UPDATE',[profiles[0].venue_id]);
    if (!recap) throw new Error('Rekap kehadiran belum tersedia.');
    const previous=roster.data.arrival_corrections?.[correction.npsn];
    let attendanceBefore=[];
    if (correction.swap_attendance_session_id != null) {
      if (!Number.isSafeInteger(correction.swap_attendance_session_id) || correction.swap_attendance_session_id < 1) throw new Error('Sesi koreksi tidak valid.');
      const {rows:records}=await client.query('SELECT * FROM attendance WHERE session_id=$1 AND person_id=ANY($2::int[]) FOR UPDATE',
        [correction.swap_attendance_session_id,profiles.map(p=>p.id)]);
      const head=records.find(a=>a.person_id===profiles.find(p=>p.position==='Kepala Sekolah').id);
      const treasurer=records.find(a=>a.person_id===profiles.find(p=>p.position==='Bendahara').id);
      if (!head || !treasurer) throw new Error('Dua catatan pada sesi koreksi harus tersedia.');
      const alreadyApplied=previous?.swap_attendance_session_id===correction.swap_attendance_session_id
        && head.status==='valid' && treasurer.status==='berhalangan';
      if (!alreadyApplied) {
        if (head.status!=='berhalangan' || treasurer.status!=='valid' || !treasurer.photo_path) throw new Error('Kondisi catatan berbeda dari koreksi yang dikonfirmasi.');
        attendanceBefore=records;
        if (apply) {
          const fields=Object.keys(head).filter(key=>!['id','person_id','session_id','event_id'].includes(key));
          if (fields.some(key=>!/^[a-z_]+$/.test(key))) throw new Error('Kolom absensi tidak valid.');
          const columns=fields.map(key=>`"${key}"`).join(',');
          const recordType=unifiedStorage()?'public.event_attendance':'attendance';
          for (const [target,source] of [[head,treasurer],[treasurer,head]]) {
            await client.query(`UPDATE attendance SET (${columns})=(SELECT ${columns} FROM jsonb_populate_record(NULL::${recordType},$1::jsonb)) WHERE id=$2`,
              [JSON.stringify(source),target.id]);
          }
        }
      }
    }
    const result={npsn:correction.npsn,venue:school.venue,profiles:profiles.map(p=>({id:p.id,before:p.name,after:correction.attendees.find(a=>a.role===p.position).name}))};
    if (apply) {
      const saved={...correction,corrected_at:new Date().toISOString(),
        before:{...(previous?.before || {school:{...school},profiles,recap}),
          attendance:previous?.before?.attendance?.length ? previous.before.attendance : attendanceBefore}};
      const data={...roster.data,schools:schools.map(s=>s===school?{...s,head_name:correction.head_name}:s),
        arrival_corrections:{...roster.data.arrival_corrections,[correction.npsn]:saved}};
      await client.query('UPDATE assignment_roster SET data=$1 WHERE id=1',[JSON.stringify(data)]);
      const marks={...recap.marks}, representatives={...recap.representatives};
      for (const profile of profiles) {
        const attendee=correction.attendees.find(a=>a.role===profile.position);
        await client.query('UPDATE people SET name=$1 WHERE id=$2',[attendee.name,profile.id]);
        marks[profile.id]=attendee.status;
        delete representatives[profile.id];
      }
      await client.query('UPDATE venue_arrival_recap SET marks=$1,representatives=$2 WHERE venue_id=$3',
        [JSON.stringify(marks),JSON.stringify(representatives),profiles[0].venue_id]);
      await client.query('COMMIT');
    } else await client.query('ROLLBACK');
    return {...result,applied:apply};
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {client.release();}
}
