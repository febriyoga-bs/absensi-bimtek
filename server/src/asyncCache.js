import { HttpError } from './util.js';
export function createAsyncCache({ ttl = 10000, maxEntries = 128, staleIfError = 0, describeStale = value=>value } = {}) {
  const entries = new Map();
  const pending = new Map();
  let generation = 0;
  return {
    clear() { generation++; entries.clear(); pending.clear(); },
    async get(key, load) {
      const saved = entries.get(key);
      if (saved && saved.expires > Date.now()) return saved.value;
      if (pending.has(key)) return pending.get(key);
      if (pending.size >= maxEntries) throw new HttpError(503, 'Server sedang sibuk. Coba lagi sebentar.');
      const version = generation;
      const request = Promise.resolve().then(load).then((value) => {
        if (version !== generation) return value;
        if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
        entries.set(key, { value, expires: Date.now() + ttl });
        return value;
      }).catch(error=>{
        if (version===generation && saved && staleIfError>0 && saved.expires+staleIfError>Date.now()) return describeStale(saved.value,error);
        throw error;
      }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
      pending.set(key, request);
      return request;
    },
  };
}
