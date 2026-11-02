// Vercel Function: semua /api/* diarahkan ke sini (lihat vercel.json).
import app, { attachErrorHandler } from '../server/src/app.js';

attachErrorHandler(app);
export default app;
