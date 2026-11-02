// Server lokal / VPS. Di Vercel yang dipakai adalah api/index.js.
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import app, { attachErrorHandler } from './app.js';
import { migrate } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}
attachErrorHandler(app);

await migrate();
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Absensi BIMTEK berjalan di http://localhost:${port}`));
