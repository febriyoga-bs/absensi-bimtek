import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { rawPool } from '../src/db.js';
import { searchPathSql } from '../src/eventContext.js';
import { hashPassword } from '../src/auth.js';

const password = 'BIMTEKREVIT2026';
const credentialsPath = '../data/kredensial-lo-baru-tahap4.local';
const norm = (value) => String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
const words = (value) => String(value).trim().split(/\s+/).map(norm).filter(Boolean);
const existingCredentials = readFileSync(credentialsPath, 'utf8').trim().split(/\r?\n/).slice(1).map((line) => line.split('\t'));
const newNames = new Set(existingCredentials.map((row) => norm(row[2])));
const c = await rawPool.connect();
try {
  await c.query('BEGIN'); const event = (await c.query('SELECT * FROM public.bimtek_events WHERE id=4')).rows[0]; await c.query(searchPathSql(event));
  const { rows: accounts } = await c.query('SELECT a.id,a.name,a.username,v.name AS venue FROM lo_accounts a JOIN venues v ON v.id=a.venue_id ORDER BY a.id');
  const created = accounts.filter((a) => newNames.has(norm(a.name)));
  if (created.length !== 80) throw new Error(`Akun baru tidak sesuai: ${created.length}.`);
  const used = new Map(accounts.filter((a) => !newNames.has(norm(a.name))).map((a) => [a.username.toLowerCase(), a.id]));
  const updated = [];
  for (const account of created) {
    const sameFirst = created.filter((a) => a.venue === account.venue && words(a.name)[0] === words(account.name)[0]);
    const parts = words(account.name).slice(0, sameFirst.length > 1 ? 2 : 1);
    const venueIndex = ['Atria Tangerang','Claro Makassar','Four Point Makassar','Harris Gubeng Surabaya','Holiday Inn Jakarta','Lumire Jakarta','Mercure Batavia Jakarta','Windham Surabaya'].indexOf(account.venue) + 1;
    const base = `LO${venueIndex}.${parts.map((p) => p[0].toUpperCase()+p.slice(1)).join('.')}`.slice(0, 29);
    let username = base, suffix = 2;
    while (used.has(username.toLowerCase())) username = `${base.slice(0, 30-String(suffix).length)}.${suffix++}`;
    used.set(username.toLowerCase(), account.id);
    await c.query('UPDATE lo_accounts SET username=$1,password_hash=$2 WHERE id=$3', [username, hashPassword(password), account.id]);
    updated.push([username, password, account.name, account.venue]);
  }
  const { rows: oldAccounts } = await c.query('SELECT name,username FROM public.lo_accounts WHERE active');
  const { rows: tahap4 } = await c.query('SELECT a.name,a.username,v.name AS venue FROM lo_accounts a JOIN venues v ON v.id=a.venue_id WHERE a.active');
  const oldNames = new Set(oldAccounts.map((x) => norm(x.name))), stage4Names = new Set(tahap4.map((x) => norm(x.name)));
  writeFileSync(credentialsPath, `Username\tPassword awal\tNama LO\tVenue\n${updated.map((x) => x.join('\t')).join('\n')}\n`);
  writeFileSync('../data/lo-summary-t4.local.json', JSON.stringify({ tahap3: oldAccounts, tahap4,
    tahap3_tidak_lanjut: oldAccounts.filter((x) => !stage4Names.has(norm(x.name))),
    tahap4_tidak_ikut: tahap4.filter((x) => !oldNames.has(norm(x.name))), }, null, 2));
  await c.query('COMMIT'); console.log(`Diperbarui: ${updated.length} akun baru.`);
} catch (error) { await c.query('ROLLBACK').catch(() => {}); throw error; } finally { c.release(); await rawPool.end(); }
