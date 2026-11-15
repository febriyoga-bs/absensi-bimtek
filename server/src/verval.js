import { HttpError } from './util.js';
import { createGate } from './concurrency.js';

const source = 'https://verval.azurewebsites.net/api/public/peta-revitalisasi';
const allowedPath = /^\/(?:overview|parts\/(?:PAUD|SD|SMP|SMA|SMK|SLB|PNFI)-\d{2}|schools\/[A-Za-z0-9_-]{4,24})$/;
const maxResponse = 8 * 1024 * 1024;
const maxCacheBytes = 32 * 1024 * 1024;
const cache = new Map(), pending = new Map();
const gate = createGate();
let cacheBytes = 0;

async function readJson(response) {
  const reader = response.body.getReader();
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxResponse) { await reader.cancel(); throw new Error('Verval response too large'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return { data: JSON.parse(Buffer.concat(chunks).toString('utf8')), size };
}

export async function getVerval(path) {
  if (!allowedPath.test(path)) throw new HttpError(400, 'Permintaan Verval tidak valid.');
  const saved = cache.get(path);
  if (saved && saved.expires > Date.now()) return saved.data;
  if (pending.has(path)) return pending.get(path);
  const request = gate(async () => {
    try {
      const response = await fetch(`${source}${path}`, { signal: AbortSignal.timeout(20000), redirect: 'error' });
      if (!response.ok) throw new Error(`Verval HTTP ${response.status}`);
      const { data, size } = await readJson(response);
      if (!data || typeof data !== 'object' || (path.startsWith('/parts/') && !Array.isArray(data.rows))) throw new Error('Invalid Verval response');
      const old = cache.get(path); if (old) { cache.delete(path); cacheBytes -= old.size; }
      while (cache.size && (cache.size >= 160 || cacheBytes + size > maxCacheBytes)) {
        const key = cache.keys().next().value; cacheBytes -= cache.get(key).size; cache.delete(key);
      }
      cache.set(path, { data, size, expires: Date.now() + 300000 }); cacheBytes += size;
      return data;
    } catch { throw new HttpError(502, 'Data Verval belum dapat dimuat. Silakan coba lagi.'); }
  }).finally(() => pending.delete(path));
  pending.set(path, request);
  return request;
}
