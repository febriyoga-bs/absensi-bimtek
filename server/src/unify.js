import 'dotenv/config';
import { mkdir,writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { rawPool } from './db.js';
import { eventTables } from './unifiedStorage.js';
import { eventSchema } from './eventContext.js';
import { unifyMigration } from './unifyMigration.js';

const args=new Set(process.argv.slice(2));
const apply=args.has('--apply'), snapshotOnly=args.has('--snapshot-only');
if (apply && !args.has('--runtime-ready')) throw new Error('Deploy runtime yang kompatibel dan hentikan sementara pencatatan sebelum memakai --apply --runtime-ready.');
const c=await rawPool.connect();
try {
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  const {rows:events}=await c.query('SELECT * FROM public.bimtek_events ORDER BY id');
  const snapshot={version:1,created_at:new Date().toISOString(),events,sources:[]};
  for(const event of events.filter(e=>e.id!==2)) {
    const schema=eventSchema(event),tables={};
    for(const table of eventTables) tables[table]=(await c.query(`SELECT * FROM "${schema}".${table}`)).rows;
    snapshot.sources.push({event:event.id,schema,tables});
  }
  const folder=new URL('../../data/backups/',import.meta.url);
  await mkdir(folder,{recursive:true});
  const file=new URL(`before-unify-${Date.now()}.local.json.gz`,folder);
  await writeFile(file,gzipSync(JSON.stringify(snapshot)),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({backup:fileURLToPath(file),counts:snapshot.sources.map(source=>({event:source.event,tables:Object.fromEntries(Object.entries(source.tables).map(([name,rows])=>[name,rows.length]))}))}));
  if(snapshotOnly){await c.query('ROLLBACK');}
  else {
    const result=await unifyMigration(c);
    await c.query(apply?'COMMIT':'ROLLBACK');
    console.log(JSON.stringify({applied:apply,dry_run:!apply,...result}));
  }
}catch(error){await c.query('ROLLBACK').catch(()=>{});console.error('Migration failed:',error.code||error.name,error.message);process.exitCode=1;}
finally{c.release();await rawPool.end();}
