import { useEffect, useState } from 'react';
import { onPendingChange } from '../api.js';

/** Balok abu-abu berkilau sebagai pengganti konten yang sedang dimuat */
export function Skel({ w = '100%', h = 14, r = 6, style, className = '' }) {
  return <span className={`skel ${className}`} style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />;
}

/** Beberapa baris teks */
export function SkelLines({ n = 3, gap = 8 }) {
  return (
    <span className="skel-lines" style={{ gap }} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <Skel key={i} w={i === n - 1 ? '60%' : `${92 - i * 7}%`} />)}
    </span>
  );
}

/** Baris tabel kerangka (dipakai di dalam <tbody>) */
export function SkelRows({ rows = 6, cols = 5 }) {
  return Array.from({ length: rows }, (_, i) => (
    <tr key={`sk${i}`} className="skel-row" aria-hidden="true">
      {Array.from({ length: cols }, (_, j) => (
        <td key={j}><Skel w={j === 0 ? '70%' : `${55 + ((i * 7 + j * 13) % 40)}%`} /></td>
      ))}
    </tr>
  ));
}

/** Kartu kerangka */
export function SkelCards({ n = 3, h = 120, className = '' }) {
  return Array.from({ length: n }, (_, i) => (
    <div key={i} className={`skel-card ${className}`} aria-hidden="true">
      <Skel w="45%" h={16} />
      <SkelLines n={2} />
      <Skel h={h - 70 > 10 ? h - 70 : 10} r={10} />
    </div>
  ));
}

/** Ikon putar kecil untuk tombol / teks "Memuat…" */
export function Spinner({ size = 16, className = '' }) {
  return <span className={`spinner ${className}`} style={{ width: size, height: size }} role="status" aria-label="Memuat" />;
}

/** Status memuat untuk area kecil: spinner + teks */
export function Loading({ text = 'Memuat…' }) {
  return <span className="loading-inline"><Spinner /> {text}</span>;
}

/**
 * Garis progres tipis di atas layar selama ada permintaan API yang belum selesai.
 * Muncul setelah 150 ms agar tidak berkedip untuk respons yang cepat.
 */
export function TopLoader() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let t;
    return onPendingChange((n) => {
      clearTimeout(t);
      if (n > 0) t = setTimeout(() => setShow(true), 150);
      else setShow(false);
    });
  }, []);
  return <div className={`top-loader ${show ? 'on' : ''}`} aria-hidden="true"><span /></div>;
}
