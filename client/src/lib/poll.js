import { useEffect, useRef } from 'react';

/**
 * Jalankan `fn` sekarang lalu tiap `ms`, tetapi BERHENTI saat tab browser
 * tidak terlihat (diminimize / pindah tab) dan langsung menyegarkan saat kembali.
 * Menghemat request ke server (kuota Vercel) dari dashboard yang dibiarkan terbuka.
 */
export function useVisiblePolling(fn, ms, deps = []) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let timer = null;
    const tick = () => { ref.current(); };
    const start = () => { stop(); timer = setInterval(tick, ms); };
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    const onVis = () => {
      if (document.hidden) stop();
      else { tick(); start(); }
    };
    tick();
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);
}
