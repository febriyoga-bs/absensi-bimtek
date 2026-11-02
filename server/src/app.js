import 'dotenv/config';
import express from 'express';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';

/**
 * Aplikasi Express tanpa listen().
 * - Vercel (services mode): file ini adalah entrypoint service "server" (lihat vercel.json).
 *   Vercel meneruskan path asli, jadi semua route tetap ber-prefix /api.
 * - Lokal / VPS: dibungkus oleh src/index.js (migrate + listen + sajikan client/dist).
 */
const app = express();

app.set('trust proxy', 1); // Vercel / Nginx mengirim X-Forwarded-For
app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});

app.use('/api/admin', adminRoutes);
app.use('/api', publicRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Tidak ditemukan' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  }
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Foto terlalu besar' });
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan server' });
});

export default app;
