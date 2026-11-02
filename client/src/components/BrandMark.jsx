import { useState } from 'react';
import Icon from './Icon.jsx';

/**
 * Logo resmi Kemendikdasmen.
 * Taruh file logo resmi di: client/public/logo-kemendikdasmen.png
 * (format lain: ganti LOGO_SRC, mis. .svg / .webp).
 * Bila file belum ada / gagal dimuat, otomatis kembali ke ikon sekolah.
 */
export const LOGO_SRC = '/logo-kemendikdasmen.png';
export const LOGO_ALT = 'Logo Kementerian Pendidikan Dasar dan Menengah';

export default function BrandMark({ size = 36, className = '' }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`brand__mark ${failed ? '' : 'brand__mark--logo'} ${className}`} style={{ width: size, height: size }}>
      {failed
        ? <Icon name="school" size={Math.round(size * 0.56)} />
        : <img src={LOGO_SRC} alt={LOGO_ALT} onError={() => setFailed(true)} />}
    </span>
  );
}
