import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { clusterSchools, hasCoordinates, indonesiaBounds, levelColors, provinceColors } from '../lib/vervalMap.js';

const number = new Intl.NumberFormat('id-ID');

function schoolIcon(color) {
  return `<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M3 12 14 4l11 8v12H3Z" fill="${color}" stroke="#fff" stroke-width="2"/><path d="M12 24v-8h5v8M7 13h3m9 0h3M7 18h3m9 0h3" fill="none" stroke="#fff" stroke-width="2"/><path d="M14 3V0h7v4h-7" fill="${color}" stroke="#fff" stroke-width="1"/></svg>`;
}

export default function VervalMap({ schools, parts, provinces, province, detailed, selected, onSelect, onProvince }) {
  const container = useRef(null);
  const wrapper = useRef(null);
  const instance = useRef(null);
  const provinceLayer = useRef(null);
  const markerLayer = useRef(null);
  const callbacks = useRef({ onSelect, onProvince });
  callbacks.current = { onSelect, onProvince };
  const [geometry, setGeometry] = useState(null);
  const [geometryError, setGeometryError] = useState('');
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/geo/indonesia-provinces.geojson', { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then(setGeometry).catch((error) => {
        if (error.name !== 'AbortError') setGeometryError('Batas wilayah belum dapat dimuat. Muat ulang halaman untuk mencoba lagi.');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const map = L.map(container.current, { zoomControl: false, scrollWheelZoom: false, minZoom: 4, maxZoom: 18,
      zoomSnap: 0.25, attributionControl: false, preferCanvas: true }).fitBounds(indonesiaBounds, { padding: [12, 12] });
    instance.current = map;
    markerLayer.current = L.layerGroup().addTo(map);
    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Perbesar peta', zoomOutTitle: 'Perkecil peta' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(container.current);
    setMapReady(true);
    return () => { resize.disconnect(); map.remove(); instance.current = null; setMapReady(false); };
  }, []);

  useEffect(() => {
    if (!geometry || !mapReady) return;
    const map = instance.current;
    const layer = L.geoJSON(geometry, {
      style: (feature) => ({ color: '#7c9b9a', weight: 1, opacity: 0.8,
        fillColor: provinceColors[Number(feature.properties.code) % provinceColors.length], fillOpacity: 0.86 }),
      onEachFeature: (feature, polygon) => {
        const label = document.createElement('span');
        label.textContent = provinces[feature.properties.code] || feature.properties.code;
        polygon.bindTooltip(label, { sticky: true });
        polygon.on('click', () => callbacks.current.onProvince(feature.properties.code));
      },
    }).addTo(map);
    provinceLayer.current = layer;
    return () => { map.removeLayer(layer); provinceLayer.current = null; };
  }, [geometry, mapReady, provinces]);

  useEffect(() => {
    if (!provinceLayer.current || !mapReady) return;
    let selectedLayer;
    provinceLayer.current.eachLayer((layer) => {
      const code = layer.feature.properties.code;
      layer.setStyle({ weight: code === province ? 2.5 : 1, color: code === province ? '#2563eb' : '#7c9b9a',
        fillOpacity: province && code !== province ? 0.25 : 0.86 });
      if (code === province) selectedLayer = layer;
    });
    if (province && selectedLayer) instance.current.fitBounds(selectedLayer.getBounds(), { padding: [35, 35], maxZoom: 10 });
    else if (!province) instance.current.fitBounds(indonesiaBounds, { padding: [12, 12] });
  }, [province, geometry, mapReady]);

  useEffect(() => {
    if (!mapReady || !markerLayer.current) return;
    const map = instance.current;
    const layer = markerLayer.current;
    function draw() {
      layer.clearLayers();
      if (!detailed) {
        provinceLayer.current?.eachLayer((shape) => {
          const code = shape.feature.properties.code;
          const count = parts.filter((part) => part.province === code).reduce((sum, part) => sum + part.count, 0);
          if (!count) return;
          const label = document.createElement('div');
          label.className = 'verval-province-label';
          const name = document.createElement('span'); name.textContent = (provinces[code] || code).replace(/^Prov\. /, '');
          const total = document.createElement('b'); total.textContent = number.format(count);
          label.append(total, name);
          L.marker(shape.getBounds().getCenter(), { icon: L.divIcon({ html: label, className: 'verval-label-icon', iconSize: [116, 42], iconAnchor: [58, 21] }) })
            .on('click', () => callbacks.current.onProvince(code)).addTo(layer);
        });
        return;
      }
      const viewport = map.getBounds().pad(0.12);
      const visible = schools.filter((school) => hasCoordinates(school) && viewport.contains([school.lat, school.lng]));
      const groups = clusterSchools(visible, (lat, lng) => map.project([lat, lng]), map.getZoom() >= 14 ? 25 : 55);
      for (const group of groups) {
        const many = group.count > 1;
        const icon = L.divIcon({ className: many ? 'verval-cluster-icon' : 'verval-school-icon',
          html: many ? `<span>${number.format(group.count)}</span>` : schoolIcon(levelColors[group.school.jenjang] || '#2563eb'),
          iconSize: many ? [42, 42] : [28, 28], iconAnchor: many ? [21, 21] : [14, 24],
        });
        const tooltip = document.createElement('span');
        tooltip.textContent = many ? `${number.format(group.count)} sekolah · Klik untuk memperbesar` : `${group.school.nama} · ${group.school.npsn}`;
        L.marker([group.lat, group.lng], { icon, title: tooltip.textContent, keyboard: true })
          .bindTooltip(tooltip).on('click', () => {
            if (!many) callbacks.current.onSelect(group.school);
            else if (map.getZoom() < 17) map.setView([group.lat, group.lng], Math.min(map.getZoom() + 2, 18));
            else {
              const list = document.createElement('div');
              list.className = 'verval-coincident-list';
              for (const school of group.schools) {
                const button = document.createElement('button');
                button.textContent = school.nama;
                button.onclick = () => { callbacks.current.onSelect(school); map.closePopup(); };
                list.append(button);
              }
              L.popup().setLatLng([group.lat, group.lng]).setContent(list).openOn(map);
            }
          }).addTo(layer);
      }
    }
    draw(); map.on('moveend zoomend', draw);
    return () => { map.off('moveend zoomend', draw); layer.clearLayers(); };
  }, [schools, parts, provinces, detailed, geometry, mapReady]);

  useEffect(() => {
    if (selected && mapReady && hasCoordinates(selected)) instance.current.setView([selected.lat, selected.lng], Math.max(instance.current.getZoom(), 13));
  }, [selected, mapReady]);

  return <div className="verval-map-wrap" ref={wrapper}>
    <div className="verval-map" ref={container} role="region" aria-label="Peta sebaran sekolah revitalisasi Indonesia" />
    <div className="verval-map-controls">
      <button type="button" onClick={() => { callbacks.current.onProvince(''); instance.current?.fitBounds(indonesiaBounds); }}>Peta Indonesia</button>
      <button type="button" onClick={() => {
        const action = document.fullscreenElement ? document.exitFullscreen() : wrapper.current.requestFullscreen?.();
        action?.catch(() => {});
      }}>Layar penuh</button>
    </div>
    <div className="verval-map-hint">Geser untuk menjelajah · + / − untuk zoom · Klik wilayah atau sekolah</div>
    {geometryError && <p role="alert" className="verval-map-error">{geometryError}</p>}
  </div>;
}
