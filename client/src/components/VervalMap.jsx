import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hasCoordinates, indonesiaBounds, provinceColors } from '../lib/vervalMap.js';
import { markerProgress, schoolMarkerMarkup } from '../lib/vervalMarkers.js';
import { schoolCanvasLayer } from '../lib/vervalCanvas.js';

const number = new Intl.NumberFormat('id-ID');

export default function VervalMap({ schools, parts, provinces, province, detailed, selected, onSelect, onProvince }) {
  const container = useRef(null);
  const wrapper = useRef(null);
  const instance = useRef(null);
  const provinceLayer = useRef(null);
  const markerLayer = useRef(null);
  const schoolLayer = useRef(null);
  const detailedView = useRef(detailed);
  detailedView.current = detailed;
  const selectedSchool = useRef(selected);
  selectedSchool.current = selected;
  const animatedSchool = useRef(null);
  const redraw = useRef(null);
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
    schoolLayer.current = schoolCanvasLayer((school) => callbacks.current.onSelect(school)).addTo(map);
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
        polygon.on('click', () => { if (!detailedView.current) callbacks.current.onProvince(feature.properties.code); });
      },
    }).addTo(map);
    provinceLayer.current = layer;
    return () => { map.removeLayer(layer); provinceLayer.current = null; };
  }, [geometry, mapReady, provinces]);

  useEffect(() => {
    provinceLayer.current?.eachLayer((shape) => {
      shape.unbindTooltip();
      if (!detailed) {
        const label = document.createElement('span'); label.textContent = provinces[shape.feature.properties.code] || shape.feature.properties.code;
        shape.bindTooltip(label, { sticky: true });
      }
    });
  }, [detailed, geometry, provinces, mapReady]);

  useEffect(() => {
    if (mapReady) schoolLayer.current?.setData(detailed ? schools : []);
  }, [schools, detailed, mapReady]);

  useEffect(() => {
    if (mapReady) schoolLayer.current?.setSelected(selected?.npsn);
  }, [selected, mapReady]);

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
          const tooltip = document.createElement('div');
          const heading = document.createElement('strong'); heading.textContent = provinces[code] || code;
          const description = document.createElement('div'); description.textContent = `${number.format(count)} sekolah · Klik untuk melihat sekolah`;
          tooltip.append(heading, description);
          L.marker(shape.getBounds().getCenter(), { title: `${provinces[code] || code} · ${number.format(count)} sekolah`,
            icon: L.divIcon({ html: label, className: 'verval-label-icon', iconSize: [116, 42], iconAnchor: [58, 21] }) })
            .bindTooltip(tooltip, { direction: 'top', offset: [0, -16], opacity: 1 })
            .on('click', () => callbacks.current.onProvince(code)).addTo(layer);
        });
        return;
      }
      const chosen = schools.find((school) => school.npsn === selectedSchool.current?.npsn && hasCoordinates(school));
      if (!chosen) return;
      const animate = animatedSchool.current !== chosen.npsn;
      const icon = L.divIcon({ className: 'verval-school-icon verval-marker-selected',
        html: schoolMarkerMarkup(chosen, { selected: true, animate }), iconSize: [48, 62], iconAnchor: [24, 45] });
      if (animate) animatedSchool.current = chosen.npsn;
      const tooltip = document.createElement('span');
      const progress = markerProgress(chosen);
      tooltip.textContent = `${chosen.nama} · ${chosen.npsn} · ${progress === null ? 'Progres belum tersedia' : `Progres ${number.format(progress)}%`}`;
      L.marker([chosen.lat, chosen.lng], { icon, title: tooltip.textContent, keyboard: true, zIndexOffset: 2000 })
        .bindTooltip(tooltip).addTo(layer);
    }
    redraw.current = draw;
    draw(); map.on('moveend zoomend', draw);
    return () => { redraw.current = null; map.off('moveend zoomend', draw); layer.clearLayers(); };
  }, [schools, parts, provinces, detailed, geometry, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    if (!selected || !hasCoordinates(selected)) {
      animatedSchool.current = null;
      redraw.current?.();
      return;
    }
    const map = instance.current;
    const frame = requestAnimationFrame(() => {
      map.invalidateSize();
      animatedSchool.current = null;
      redraw.current?.();
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      map.flyTo([selected.lat, selected.lng], Math.max(map.getZoom(), 13), { duration: 0.8, animate: !reducedMotion });
    });
    return () => cancelAnimationFrame(frame);
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
    {geometryError && <p role="alert" className="verval-map-error">{geometryError}</p>}
  </div>;
}
