import { HttpError } from './util.js';

const source = 'https://verval.azurewebsites.net/api/public/peta-revitalisasi';
const cache = new Map();
const pending = new Map();
const ttl = 5 * 60 * 1000;

export async function getVerval(path) {
  const saved = cache.get(path);
  if (saved && Date.now() - saved.time < ttl) return saved.data;
  if (pending.has(path)) return pending.get(path);
  const request = (async () => {
    try {
      const response = await fetch(`${source}${path}`, { signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error(`Verval HTTP ${response.status}`);
      const data = await response.json();
      if (!data || typeof data !== 'object' || (path.startsWith('/parts/') && !Array.isArray(data.rows))) {
        throw new Error('Invalid Verval response');
      }
      if (cache.size >= 160) cache.delete(cache.keys().next().value);
      cache.set(path, { time: Date.now(), data });
      return data;
    } catch {
      throw new HttpError(502, 'Data Verval belum dapat dimuat. Silakan coba lagi.');
    } finally {
      pending.delete(path);
    }
  })();
  pending.set(path, request);
  return request;
}
