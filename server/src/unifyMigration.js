import { readFileSync } from 'node:fs';
import { eventTables } from './unifiedStorage.js';
import { eventSchema } from './eventContext.js';

const quoted = (name) => `"${String(name).replace(/"/g, '""')}"`;
const keys = { settings:['id'], venues:['id'], people:['id'], sessions:['id'], attendance:['id'], attempt_logs:['id'],
  lo_accounts:['id'], assignment_roster:['id'], school_reporting:['npsn'], school_progress_report:['npsn'], venue_arrival_recap:['venue_id'] };
const foreignKeys = [
  ['people','venue_id','venues','SET NULL (venue_id)'], ['attendance','person_id','people','CASCADE'],
  ['attendance','session_id','sessions','CASCADE'], ['attendance','venue_id','venues','SET NULL (venue_id)'],
  ['attempt_logs','person_id','people','CASCADE'], ['attempt_logs','session_id','sessions','CASCADE'],
  ['attempt_logs','venue_id','venues','SET NULL (venue_id)'], ['lo_accounts','venue_id','venues','CASCADE'],
  ['venue_arrival_recap','venue_id','venues','CASCADE'],
];

// Caller owns BEGIN/COMMIT. --dry-run rolls this entire operation back.
// No legacy table, schema, ID, QR token or photo reference is deleted or changed.
export async function unifyMigration(client) {
  await client.query("SELECT pg_advisory_xact_lock(78103421); SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s'");
  const {rows:[exists]} = await client.query("SELECT to_regclass('public.bimtek_storage') AS name");
  if (exists.name && (await client.query('SELECT unified FROM public.bimtek_storage WHERE id=1')).rows[0]?.unified) return { alreadyUnified:true };
  const {rows:events} = await client.query('SELECT * FROM public.bimtek_events ORDER BY id');
  if (!events.length || !events.some((event) => event.id===3 && event.schema_name==='public')) throw new Error('Metadata kegiatan lama tidak valid.');
  const sources = events.filter((event) => event.id!==2);
  const sourceTables = sources.flatMap((event) => eventTables.map((table) => `${quoted(eventSchema(event))}.${quoted(table)}`));
  await client.query(`LOCK TABLE ${sourceTables.join(',')} IN SHARE MODE`);
  await client.query(`CREATE TABLE IF NOT EXISTS public.bimtek_storage(id int PRIMARY KEY CHECK(id=1),unified boolean NOT NULL);
    ALTER TABLE public.bimtek_storage ENABLE ROW LEVEL SECURITY;
    INSERT INTO public.bimtek_storage VALUES(1,false) ON CONFLICT(id) DO NOTHING`);
  const {rows:[role]} = await client.query("SELECT rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname='bimtek_app'");
  if (!role) await client.query('CREATE ROLE bimtek_app NOLOGIN NOSUPERUSER NOBYPASSRLS');
  else if (role.rolsuper || role.rolbypassrls || role.rolcanlogin) throw new Error('Role bimtek_app harus NOLOGIN dan tidak boleh melewati RLS.');
  const {rows:[owner]} = await client.query('SELECT current_user AS name');
  await client.query(`GRANT bimtek_app TO ${quoted(owner.name)}; GRANT USAGE ON SCHEMA public TO bimtek_app;
    GRANT SELECT ON public.bimtek_events, public.bimtek_storage TO bimtek_app`);
  const summary = [];
  for (const table of eventTables) {
    const target = `public.event_${table}`;
    if ((await client.query('SELECT to_regclass($1) AS name',[target])).rows[0].name) throw new Error(`Tabel tujuan ${target} sudah ada tetapi migrasi belum ditandai selesai.`);
    await client.query(`CREATE TABLE ${target} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED,
      event_id int NOT NULL DEFAULT NULLIF(current_setting('app.event_id',true),'')::int REFERENCES public.bimtek_events(id));
      ALTER TABLE ${target} ADD PRIMARY KEY (event_id,${keys[table].join(',')})`);
    const {rows:columns} = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,[table]);
    const names = columns.map((column) => quoted(column.column_name)).join(',');
    for (const event of sources) {
      const source = `${quoted(eventSchema(event))}.${quoted(table)}`;
      await client.query(`INSERT INTO ${target} (${names},event_id) SELECT ${names},$1 FROM ${source}`, [event.id]);
      const fingerprint = (from, condition, value) => client.query(`SELECT count(*)::int AS count,
        md5(COALESCE(string_agg(md5((${value})::text),'' ORDER BY md5((${value})::text)),'')) AS digest FROM ${from} row ${condition}`);
      const a = (await fingerprint(source,'','to_jsonb(row)')).rows[0];
      const b = (await fingerprint(target,`WHERE event_id=${event.id}`,"to_jsonb(row)-'event_id'")).rows[0];
      if (a.count!==b.count || a.digest!==b.digest) throw new Error(`Verifikasi data gagal: tahap ${event.id}, ${table}`);
      summary.push({event:event.id,table,rows:a.count,verified:true});
    }
    const serial = columns.some((column) => column.column_name==='id')
      && (await client.query('SELECT pg_get_serial_sequence($1,$2) AS name',[`public.${table}`,'id'])).rows[0]?.name;
    if (serial) {
      await client.query(`CREATE SEQUENCE public.event_${table}_id_seq OWNED BY ${target}.id;
        ALTER TABLE ${target} ALTER COLUMN id SET DEFAULT nextval('public.event_${table}_id_seq');
        SELECT setval('public.event_${table}_id_seq',GREATEST(COALESCE(max(id),0),1),COALESCE(max(id),0)>0) FROM ${target};
        GRANT USAGE,SELECT ON SEQUENCE public.event_${table}_id_seq TO bimtek_app`);
    }
    await client.query(`ALTER TABLE ${target} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY event_isolation ON ${target} TO bimtek_app
        USING(event_id=NULLIF(current_setting('app.event_id',true),'')::int)
        WITH CHECK(event_id=NULLIF(current_setting('app.event_id',true),'')::int);
      REVOKE ALL ON ${target} FROM PUBLIC;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ${target} TO bimtek_app`);
  }
  for (const [table,column,parent,deletion] of foreignKeys) await client.query(`ALTER TABLE public.event_${table}
    ADD FOREIGN KEY(event_id,${column}) REFERENCES public.event_${parent}(event_id,id) ON DELETE ${deletion}`);
  await client.query(`CREATE UNIQUE INDEX event_people_code_uq ON public.event_people(event_id,lower(code));
    CREATE UNIQUE INDEX event_people_qr_uq ON public.event_people(event_id,qr_token);
    CREATE UNIQUE INDEX event_lo_username_uq ON public.event_lo_accounts(event_id,lower(username));
    CREATE UNIQUE INDEX event_attendance_person_session_uq ON public.event_attendance(event_id,person_id,session_id);
    CREATE INDEX event_attendance_session_venue_idx ON public.event_attendance(event_id,session_id,venue_id);
    CREATE INDEX event_attendance_page_idx ON public.event_attendance(event_id,session_id,risk_score DESC,created_at DESC);
    CREATE INDEX event_attendance_device_idx ON public.event_attendance(event_id,session_id,device_id);
    CREATE INDEX event_attempt_session_venue_idx ON public.event_attempt_logs(event_id,session_id,venue_id);
    CREATE INDEX event_people_venue_role_idx ON public.event_people(event_id,venue_id,role);
    INSERT INTO public.bimtek_events(id,name,schema_name,status) VALUES(2,'BIMTEK Tahap 2','bimtek_2','archived') ON CONFLICT(id) DO NOTHING`);
  const archive = JSON.parse(readFileSync(new URL('./reportingK3.json',import.meta.url),'utf8'));
  await client.query(`INSERT INTO public.event_assignment_roster(event_id,id,data) VALUES(2,1,$1)`,[JSON.stringify({archive,venues:archive.venues,lo:archive.lo})]);
  await client.query(`INSERT INTO public.event_settings(event_id,id,event_name,venue_secret) VALUES(2,1,'BIMTEK Tahap 2',md5(random()::text));
    UPDATE public.bimtek_storage SET unified=true WHERE id=1`);
  return {alreadyUnified:false,storage:'public.event_*',sourcesRetained:true,summary};
}
