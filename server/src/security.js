import rateLimit from 'express-rate-limit';

export const requestLimiter = rateLimit({ windowMs: 60_000, limit: 3000,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Terlalu banyak permintaan dari jaringan ini. Tunggu sebentar, lalu coba lagi.' },
});
export const publicReadLimiter = rateLimit({ windowMs: 60_000, limit: 600,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Dasbor sedang menerima terlalu banyak permintaan. Coba lagi dalam satu menit.' },
});
export const vervalLimiter = rateLimit({ windowMs: 60_000, limit: 2000,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Permintaan peta terlalu banyak. Coba lagi dalam satu menit.' },
});
export const schoolDetailLimiter = rateLimit({ windowMs: 60_000, limit: 120,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Terlalu banyak permintaan rincian sekolah. Coba lagi sebentar.' },
});

export function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Content-Security-Policy', "frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
  res.set('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
}

export function finiteInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}
