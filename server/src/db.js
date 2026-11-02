import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverless = !!process.env.VERCEL;

/**
 * Supabase pooler (Supavisor) mode transaksi, port 6543.
 * Di serverless tiap instance hanya butuh sedikit koneksi; pooler-lah
 * yang membagi koneksi ke Postgres. Kode ini tidak memakai prepared
 * statement bernama / fitur sesi, jadi aman untuk mode transaksi.
 */
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX || (serverless ? 3 : 10)),
  idleTimeoutMillis: serverless ? 5_000 : 30_000,
  connectionTimeoutMillis: 10_000,
});
pool.on('error', (e) => console.error('pg pool error', e.message));

export const q = (text, params) => pool.query(text, params);

export async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

export async function getSettings() {
  const { rows } = await q('SELECT * FROM settings WHERE id = 1');
  return rows[0];
}
