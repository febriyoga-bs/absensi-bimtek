import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';

/**
 * Google Maps yang ditanam langsung di halaman (iframe embed, tanpa API key),
 * jadi admin tidak perlu membuka tab baru.
 */
export function mapEmbedUrl(lat, lng, { zoom = 17, satellite = false } = {}) {
  const q = `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
  return `https://maps.google.com/maps?q=${q}&z=${zoom}&t=${satellite ? 'k' : 'm'}&hl=id&output=embed`;
}

export const validCoord = (lat, lng) =>
  lat !== '' && lng !== '' && lat != null && lng != null &&
  Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) &&
  Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;

export function MapEmbed({ lat, lng, height = 320, zoom = 17 }) {
  const [sat, setSat] = useState(false);
  if (!validCoord(lat, lng)) return null;
  return (
    <div className="map-embed" style={{ height }}>
      <iframe
        title="Peta lokasi"
        src={mapEmbedUrl(lat, lng, { zoom, satellite: sat })}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
      <div className="map-embed__toggle" role="group" aria-label="Jenis peta">
        <button type="button" className={!sat ? 'on' : ''} onClick={() => setSat(false)}>Peta</button>
        <button type="button" className={sat ? 'on' : ''} onClick={() => setSat(true)}>Satelit</button>
      </div>
    </div>
  );
}

/**
 * Modal peta. `point` = { lat, lng, title, rows: [[label, value], ...] } atau null.
 */
export function MapModal({ point, onClose }) {
  useEffect(() => {
    if (!point) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [point, onClose]);

  if (!point) return null;
  return (
    <div className="map-modal" onClick={onClose}>
      <div className="map-modal__box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="map-modal__head">
          <span className="map-modal__title"><Icon name="pin" size={20} />{point.title || 'Lokasi'}</span>
          <button type="button" className="btn btn--sm" onClick={onClose} aria-label="Tutup"><Icon name="x" size={16} />Tutup</button>
        </div>
        <MapEmbed lat={point.lat} lng={point.lng} height={460} />
        <dl className="map-modal__info">
          <div><dt>Koordinat</dt><dd>{Number(point.lat).toFixed(6)}, {Number(point.lng).toFixed(6)}</dd></div>
          {(point.rows || []).filter(([, v]) => v != null && v !== '').map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      </div>
    </div>
  );
}
