import { HttpError } from './util.js';

// Public Revit pages are shared across dashboard requests; never cache user data here.
export function createRevitReader({ fetchPage = (...args) => fetch(...args), ttl = 300000, now = Date.now,
  pause = ms => new Promise(resolve=>setTimeout(resolve,ms)), interval = 150, binary = false } = {}) {
  const saved = new Map(), pending = new Map();
  const blocked=new Map();
  let queue=Promise.resolve();
  return async function read(url) {
    const key = String(url), cached = saved.get(key);
    if (cached && now() - cached.at < ttl) return cached.html;
    if (pending.has(key)) return pending.get(key);
    const request = queue.then(async () => {
      const origin=new URL(key).origin;
      const retryAt=blocked.get(origin) || 0;
      if (now()<retryAt) throw new HttpError(503,`Revit sedang membatasi akses. Coba lagi dalam ${Math.ceil((retryAt-now())/1000)} detik.`);
      let error;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetchPage(key, { headers: { Accept: binary ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/html', 'User-Agent': 'BIMTEK-Dashboard/1.0' }, signal: AbortSignal.timeout(15000) });
          if (!response.ok) {
            if (response.status===429) {
              const header=response.headers?.get?.('retry-after');
              const seconds=header && /^\d+$/.test(header) ? Number(header)
                : header && Number.isFinite(Date.parse(header)) ? Math.ceil((Date.parse(header)-now())/1000) : 60;
              const wait=Math.max(1,Math.min(3600,seconds));
              blocked.set(origin,now()+wait*1000);
              throw new HttpError(503,`Revit sedang membatasi akses (HTTP 429). Coba lagi dalam ${wait} detik.`);
            }
            error = new HttpError(502, `Revit merespons HTTP ${response.status}. Coba muat ulang sebentar lagi.`);
            if (![502, 503, 504].includes(response.status)) break;
            await pause(500);
            continue;
          }
          const html = binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
          if (binary ? !html.length : !html.trim()) throw new Error('empty response');
          // An HTML error/login page can be returned with HTTP 200. Do not cache
          // it for five minutes as if it were a valid Excel export.
          if(binary && (html[0]!==80 || html[1]!==75))
            throw new HttpError(503,'Revit mengembalikan respons selain file Excel. Coba muat ulang.');
          if (saved.size >= 256) saved.delete(saved.keys().next().value);
          saved.set(key, { at: now(), html });
          return html;
        } catch (cause) {
          if (cause instanceof HttpError && cause.status===503) throw cause;
          error = new HttpError(502, 'Tidak dapat mengambil data dari Revit. Coba muat ulang sebentar lagi.');
        }
      }
      throw error;
    }).finally(() => pending.delete(key));
    queue=request.catch(()=>{}).then(()=>pause(interval));
    pending.set(key, request);
    return request;
  };
}
export const readRevitHtml = createRevitReader();

// Cache only after the workbook has been parsed and validated by loadProgressExport.
// A malformed ZIP must not poison the raw-response cache for five minutes.
export const readRevitExport = createRevitReader({binary:true,ttl:0});
