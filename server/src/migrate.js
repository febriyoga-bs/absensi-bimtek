// Jalankan sekali sebelum/after deploy:  npm --prefix server run migrate
import 'dotenv/config';
import { migrate, pool } from './db.js';

await migrate();
console.log('Migrasi database selesai.');
await pool.end();
