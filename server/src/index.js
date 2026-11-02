// Server lokal / VPS. Di Vercel, service "server" memakai src/app.js langsung (lihat vercel.json).
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import api from './app.js';
import { migrate } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../../client/dist');

const root = express();
root.use(api); // semua /api/*
if (fs.existsSync(dist)) {
  // Mode produksi tanpa Vercel: sajikan build React + fallback SPA
  root.use(express.static(dist, { index: false }));
  root.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

await migrate();
const port = Number(process.env.PORT || 3000);
root.listen(port, () => console.log(`Absensi BIMTEK berjalan di http://localhost:${port}`));
