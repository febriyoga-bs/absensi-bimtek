import { HttpError } from './util.js';

export function createGate({ activeLimit = 4, queueLimit = 32, waitMs = 8000 } = {}) {
  let active = 0;
  const queue = [];
  function release() {
    const next = queue.shift();
    if (next) { clearTimeout(next.timer); next.resolve(); }
    else active -= 1;
  }
  return async function run(task) {
    if (active < activeLimit) active += 1;
    else {
      if (queue.length >= queueLimit) throw new HttpError(503, 'Server sedang sibuk. Coba lagi sebentar.');
      await new Promise((resolve, reject) => {
        const entry = { resolve };
        entry.timer = setTimeout(() => {
          const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1);
          reject(new HttpError(503, 'Antrean terlalu lama. Coba lagi sebentar.'));
        }, waitMs);
        queue.push(entry);
      });
    }
    try { return await task(); } finally { release(); }
  };
}
