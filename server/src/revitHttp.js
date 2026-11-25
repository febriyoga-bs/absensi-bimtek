import { HttpError } from './util.js';

// Public Revit pages are shared across dashboard requests; never cache user data here.
export function createRevitReader({ fetchPage = (...args) => fetch(...args), ttl = 120000, now = Date.now } = {}) {
  const saved = new Map(), pending = new Map();
  return async function read(url) {
    const key = String(url), cached = saved.get(key);
    if (cached && now() - cached.at < ttl) return cached.html;
    if (pending.has(key)) return pending.get(key);
    const request = (async () => {
      let error;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetchPage(key, { headers: { Accept: 'text/html', 'User-Agent': 'BIMTEK-Dashboard/1.0' }, signal: AbortSignal.timeout(15000) });
          if (!response.ok) {
            error = new HttpError(502, `Revit merespons HTTP ${response.status}. Coba muat ulang sebentar lagi.`);
            if (![429, 502, 503, 504].includes(response.status)) break;
            continue;
          }
          const html = await response.text();
          if (!html.trim()) throw new Error('empty response');
          if (saved.size >= 256) saved.delete(saved.keys().next().value);
          saved.set(key, { at: now(), html });
          return html;
        } catch (cause) {
          error = new HttpError(502, 'Tidak dapat mengambil data dari Revit. Coba muat ulang sebentar lagi.');
        }
      }
      throw error;
    })().finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}
export const readRevitHtml = createRevitReader();
