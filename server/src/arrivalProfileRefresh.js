import { createAsyncCache } from './asyncCache.js';

// Cache only completion of reconciliation, never participant/attendance results.
export function createArrivalProfileRefresh(load, { ttl = 10000 } = {}) {
  const cache = createAsyncCache({ ttl, maxEntries: 64 });
  return {
    clear: () => cache.clear(),
    refresh(event, venue = null) {
      return cache.get(`${event}:${venue ?? 'all'}`, () => load(venue));
    },
  };
}
