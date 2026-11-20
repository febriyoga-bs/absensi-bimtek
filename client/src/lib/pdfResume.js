export function preparePdfResume(state, key) {
  if (state.key !== key) {
    state.key = key;
    state.records = [];
    state.dataComplete = false;
    state.photos = new Map();
  }
  return state;
}
export async function cachedPdfPhoto(state, key, load, { onRetry, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (state.photos.has(key)) return state.photos.get(key);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const photo = await load();
      state.photos.set(key, photo);
      return photo;
    } catch (error) {
      if (attempt === 3 || error.retryable === false) throw error;
      onRetry?.(attempt + 1);
      await wait(attempt * 1000);
    }
  }
}

export function prepareVenuePdfBatch(state, key) {
  if (state.batchKey !== key) {
    state.batchKey = key;
    state.completedVenues = new Map();
    state.emptyVenues = new Set();
    state.currentVenue = {};
  }
  return state;
}
