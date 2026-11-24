import 'dotenv/config';
import express from 'express';
import publicRoutes from './routes/public.js';
import adminRoutes, { loginHandler, loginLimiter } from './routes/admin.js';
import { requestLimiter, securityHeaders } from './security.js';
import { eventRoutes, selectEvent, invalidateEventMetadata } from './events.js';
import { publicPksRoutes } from './pks.js';

/**
 * Aplikasi Express tanpa listen().
 * - Vercel (services mode): file ini adalah entrypoint service "server" (lihat vercel.json).
 *   Vercel meneruskan path asli, jadi semua route tetap ber-prefix /api.
 * - Lokal / VPS: dibungkus oleh src/index.js (migrate + listen + sajikan client/dist).
 */
const app = express();

app.set('trust proxy', 1); // Vercel / Nginx mengirim X-Forwarded-For
app.disable('x-powered-by');
app.use(securityHeaders);
app.use('/api', requestLimiter);
app.use(express.json({ limit: '3mb' }));
app.use((req, res, next) => {
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && /^\/api\/admin\/sessions(?:\/|$)/.test(req.path)) {
    res.once('finish', () => { if (res.statusCode < 400) invalidateEventMetadata(); });
  }
  next();
});
app.use('/api/events', eventRoutes);
app.post('/api/admin/login', loginLimiter, loginHandler);
app.use('/api', selectEvent);

app.use('/api/admin', adminRoutes);
app.use('/api/pks', publicPksRoutes);
app.use('/api', publicRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Tidak ditemukan' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Ukuran permintaan terlalu besar.' });
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  }
  if (err.status === 502 || err.status === 503 || err.status === 504) return res.status(err.status).json({ error: err.message });
  // Keep the cause in server logs; never send connection details to the client.
  const message = String(err.message || 'Unknown error')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database URL redacted]');
  console.error('Request failed', { method: req.method, path: req.path, code: err.code || err.name, message });
  if (req.path === '/api/admin/export' && (err.code === '57014' || err.message === 'Query read timeout')) {
    return res.status(504).json({ error: 'Pengambilan data ekspor melewati batas waktu. Coba unduh per venue atau ulangi beberapa saat lagi.' });
  }
  res.status(500).json({ error: 'Terjadi kesalahan server' });
});

export default app;
