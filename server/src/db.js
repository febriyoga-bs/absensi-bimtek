import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { currentEvent, searchPathSql } from './eventContext.js';
import { scopedConnection } from './scopedConnection.js';
import { eventSql, unifiedStorage, setUnifiedStorage } from './unifiedStorage.js';
import { discardDatabaseConnection } from './databaseErrors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverless = !!process.env.VERCEL;
const bounded = (value, fallback, max) => Number.isInteger(Number(value)) && Number(value) > 0 ? Math.min(Number(value), max) : fallback;

/**
 * Supabase pooler (Supavisor) mode transaksi, port 6543.
 * Di serverless tiap instance hanya butuh sedikit koneksi; pooler-lah
 * yang membagi koneksi ke Postgres. Kode ini tidak memakai prepared
 * statement bernama / fitur sesi, jadi aman untuk mode transaksi.
 */
export const rawPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: bounded(process.env.PG_POOL_MAX, serverless ? 5 : 10, 20),
  idleTimeoutMillis: serverless ? 5_000 : 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: bounded(process.env.PG_STATEMENT_TIMEOUT_MS, 20000, 120000),
  query_timeout: bounded(process.env.PG_QUERY_TIMEOUT_MS, 25000, 130000),
  idle_in_transaction_session_timeout: 20000,
});
rawPool.on('error', (e) => console.error('pg pool error', e.message));
// Pool error handlers cover idle clients only. Checked-out clients also need
// a listener so a dropped socket cannot crash the entire serverless instance.
rawPool.on('connect', (client) => {
  client.on('error', (error) => console.error('pg connection error', { code: error.code || error.name }));
});

let storageCheck, storageCheckedAt = 0;
export async function ensureStorageMode() {
  if (Date.now() - storageCheckedAt < 5000) return unifiedStorage();
  if (!storageCheck) storageCheck = (async () => {
    const { rows: [table] } = await rawPool.query("SELECT to_regclass('public.bimtek_storage') AS name");
    const enabled = table?.name && (await rawPool.query('SELECT unified FROM public.bimtek_storage WHERE id=1')).rows[0]?.unified;
    setUnifiedStorage(!!enabled); storageCheckedAt = Date.now(); return !!enabled;
  })().finally(() => { storageCheck = null; });
  return storageCheck;
}

export const q = async (text, params) => {
  await ensureStorageMode();
  if (rawPool.waitingCount >= 100) {
    const error = new Error('Server database sedang sibuk. Coba lagi sebentar.'); error.status = 503; throw error;
  }
  const client = await rawPool.connect();
  let releaseError;
  try {
    await client.query(`BEGIN; ${searchPathSql()}`);
    const result = await client.query(eventSql(text), params);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (discardDatabaseConnection(error)) releaseError = error;
    else {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) { releaseError = rollbackError; }
    }
    throw error;
  } finally { client.release(releaseError); }
};

export const pool = {
  query: q,
  end: () => rawPool.end(),
  async connect() {
    await ensureStorageMode();
    const client = await rawPool.connect();
    return scopedConnection(client, currentEvent());
  },
};

export async function migrate() {
  if (await ensureStorageMode()) {
    await rawPool.query("ALTER TABLE public.event_attendance ADD COLUMN IF NOT EXISTS photo_history JSONB NOT NULL DEFAULT '[]'::jsonb");
    return;
  }
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await rawPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(78103421)");
    await client.query(searchPathSql({ schema_name: 'public' }));
    await client.query(sql);
    await client.query(`CREATE TABLE IF NOT EXISTS public.bimtek_events (
      id INT PRIMARY KEY CHECK (id > 0), name TEXT NOT NULL,
      schema_name TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('draft','active','archived')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS bimtek_one_active ON public.bimtek_events ((status)) WHERE status='active';
    ALTER TABLE public.bimtek_events ENABLE ROW LEVEL SECURITY;
    INSERT INTO public.bimtek_events (id,name,schema_name,status) VALUES
      (3,'BIMTEK Tahap 3','public','active'), (4,'BIMTEK Tahap 4','bimtek_4','draft') ON CONFLICT (id) DO NOTHING;`);
    const { rows } = await client.query('SELECT * FROM public.bimtek_events WHERE id<>3 ORDER BY id');
    for (const event of rows) {
      const schema = event.schema_name;
      // Validate names before interpolating identifiers.
      searchPathSql(event);
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await client.query(searchPathSql(event));
      await client.query(sql);
      await client.query("UPDATE settings SET event_name=$1 WHERE id=1 AND event_name='BIMTEK Revitalisasi SD'", [event.name]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function getSettings() {
  const { rows } = await q('SELECT * FROM settings WHERE id = 1');
  return rows[0];
}
