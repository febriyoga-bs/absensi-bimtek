import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverless = !!process.env.VERCEL;
const bounded = (value, fallback, max) => Number.isInteger(Number(value)) && Number(value) > 0 ? Math.min(Number(value), max) : fallback;

/**
 * Supabase pooler (Supavisor) mode transaksi, port 6543.
 * Di serverless tiap instance hanya butuh sedikit koneksi; pooler-lah
 * yang membagi koneksi ke Postgres. Kode ini tidak memakai prepared
 * statement bernama / fitur sesi, jadi aman untuk mode transaksi.
 */
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: bounded(process.env.PG_POOL_MAX, serverless ? 5 : 10, 20),
  idleTimeoutMillis: serverless ? 5_000 : 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: bounded(process.env.PG_STATEMENT_TIMEOUT_MS, 20000, 120000),
  query_timeout: bounded(process.env.PG_QUERY_TIMEOUT_MS, 25000, 130000),
  idle_in_transaction_session_timeout: 20000,
});
pool.on('error', (e) => console.error('pg pool error', e.message));

export const q = (text, params) => {
  if (pool.waitingCount >= 100) {
    const error = new Error('Server database sedang sibuk. Coba lagi sebentar.'); error.status = 503; throw error;
  }
  return pool.query(text, params);
};

export async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

export async function getSettings() {
  const { rows } = await q('SELECT * FROM settings WHERE id = 1');
  return rows[0];
}
