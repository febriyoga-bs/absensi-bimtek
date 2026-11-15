import L from 'leaflet';
import { hasCoordinates, levelColors } from './vervalMap.js';
import { markerProgress } from './vervalMarkers.js';

const number = new Intl.NumberFormat('id-ID');
const sprites = new Map();
const house = new Path2D('M10 25 24 12 38 25V45H10Z');

function sprite(school) {
  const color = levelColors[school.jenjang] || '#2563eb';
  const progress = markerProgress(school);
  const amount = progress === null ? null : Math.round(progress);
  const key = `${color}:${amount}`;
  if (sprites.has(key)) return sprites.get(key);
  const image = document.createElement('canvas'); image.width = 48; image.height = 62;
  const ctx = image.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fill(house);
  ctx.save(); ctx.clip(house); ctx.fillStyle = color;
  ctx.fillRect(8, 45 - 33 * (amount || 0) / 100, 32, 33 * (amount || 0) / 100); ctx.restore();
  ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
  if (amount === null) ctx.setLineDash([3, 2]);
  ctx.stroke(house); ctx.setLineDash([]);
  ctx.strokeStyle = '#28425e'; ctx.lineWidth = 1.5;
  ctx.stroke(new Path2D('M21 45V34h7v11M15 28h4m11 0h4'));
  if (amount === 100) { ctx.fillStyle = color; const flag = new Path2D('M25 12V3m0 0h9v5h-9'); ctx.fill(flag); ctx.strokeStyle = color; ctx.stroke(flag); }
  sprites.set(key, image);
  return image;
}

// One canvas for every visible school. A small screen grid handles pointer hit
// testing; the selected school keeps its accessible, animated DOM marker.
const SchoolCanvas = L.Layer.extend({
  initialize(onSelect) { this._onSelect = onSelect; this._points = []; this._grid = new Map(); this._generation = 0; },
  onAdd(map) {
    this._map = map;
    let pane = map.getPane('vervalSchools');
    if (!pane) { pane = map.createPane('vervalSchools'); pane.style.zIndex = '450'; pane.style.pointerEvents = 'none'; }
    this._canvas = L.DomUtil.create('canvas', 'verval-school-canvas leaflet-zoom-hide', pane);
    this._canvas.style.pointerEvents = 'none'; this._canvas.setAttribute('aria-hidden', 'true');
    this._tooltip = L.tooltip({ direction: 'top', offset: [0, -10], opacity: 1, className: 'verval-canvas-tooltip' });
    this._reset();
  },
  onRemove(map) {
    this._generation += 1; cancelAnimationFrame(this._frame); cancelAnimationFrame(this._scheduled);
    map.removeLayer(this._tooltip); this._canvas.remove(); map.getContainer().style.cursor = '';
  },
  getEvents() { return { moveend: this._schedule, zoomstart: this._hide, zoomend: this._zoomEnd, resize: this._schedule, mousemove: this._hover, mouseout: this._leave, click: this._click }; },
  setData(schools) {
    this._points = [];
    for (const school of schools) {
      if (!hasCoordinates(school)) continue;
      const sin = Math.sin(school.lat * Math.PI / 180);
      this._points.push({ school, x: (school.lng + 180) / 360 * 256, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 256 });
    }
    this._schedule(); return this;
  },
  setSelected(id) { this._selected = id; this._schedule(); },
  _hide() { this._zooming = true; this._canvas.style.opacity = '0'; this._generation += 1; cancelAnimationFrame(this._frame); this._leave(); },
  _zoomEnd() { this._zooming = false; this._schedule(); },
  _schedule() { if (this._zooming) return; cancelAnimationFrame(this._scheduled); this._scheduled = requestAnimationFrame(() => { if (!this._zooming) this._reset(); }); },
  _reset() {
    if (!this._map || !this._canvas) return;
    const generation = ++this._generation;
    cancelAnimationFrame(this._frame);
    const map = this._map, canvas = this._canvas, size = map.getSize(), ratio = Math.min(devicePixelRatio || 1, 2);
    const origin = map.getPixelBounds().min, scale = 2 ** map.getZoom();
    const width = map.getZoom() < 6 ? 11 : map.getZoom() < 10 ? 18 : 32;
    const height = width * 62 / 48;
    const grid = new Map();
    const buffer = document.createElement('canvas');
    buffer.width = Math.round(size.x * ratio); buffer.height = Math.round(size.y * ratio);
    const position = map.containerPointToLayerPoint([0, 0]);
    const ctx = buffer.getContext('2d'); ctx.scale(ratio, ratio);
    const points = this._points; let index = 0, rendered = 0, cpu = 0;
    canvas.dataset.totalCount = String(points.length);
    const batch = () => {
      if (generation !== this._generation) return;
      const start = performance.now();
      while (index < points.length) {
        const point = points[index++], school = point.school;
        if (school.npsn === this._selected) continue;
        const x = point.x * scale - origin.x, y = point.y * scale - origin.y;
        if (x < -width || x > size.x + width || y < -height || y > size.y + height) continue;
        ctx.drawImage(sprite(school), x - width / 2, y - height * 45 / 62, width, height);
        const key = `${Math.floor(x / 24)}:${Math.floor(y / 24)}`;
        const cell = grid.get(key) || []; cell.push({ school, x, y }); grid.set(key, cell);
        rendered += 1;
        if (performance.now() - start > 6) break;
      }
      cpu += performance.now() - start;
      if (index < points.length) this._frame = requestAnimationFrame(batch);
      else {
        canvas.width = buffer.width; canvas.height = buffer.height;
        canvas.style.width = `${size.x}px`; canvas.style.height = `${size.y}px`;
        L.DomUtil.setPosition(canvas, position);
        canvas.getContext('2d').drawImage(buffer, 0, 0);
        this._grid = grid; this._hitRadius = Math.max(width / 2, 9); this._hovered = null;
        canvas.style.opacity = '1'; canvas.dataset.renderedCount = String(rendered);
        canvas.dataset.renderMs = cpu.toFixed(1); canvas.dataset.ready = 'true';
      }
    };
    canvas.dataset.ready = 'false'; batch();
  },
  _hit(point) {
    if (this._map.dragging?.moving() || this._canvas.style.opacity === '0' || this._canvas.dataset.ready !== 'true') return null;
    const column = Math.floor(point.x / 24), row = Math.floor(point.y / 24);
    let best = null, distance = this._hitRadius ** 2;
    for (let x = column - 1; x <= column + 1; x++) for (let y = row - 1; y <= row + 1; y++) {
      for (const candidate of this._grid.get(`${x}:${y}`) || []) {
        const d = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2;
        if (d <= distance) { distance = d; best = candidate.school; }
      }
    }
    return best;
  },
  _hover(event) {
    const school = this._hit(event.containerPoint);
    this._map.getContainer().style.cursor = school ? 'pointer' : '';
    if (!school) return this._leave();
    if (this._hovered !== school.npsn) {
      const content = document.createElement('div'), name = document.createElement('strong'), detail = document.createElement('div');
      name.textContent = school.nama;
      const progress = markerProgress(school);
      detail.textContent = `${school.jenjang} · ${school.npsn} · ${progress === null ? 'Progres belum tersedia' : `${number.format(progress)}%`}`;
      content.append(name, detail); this._tooltip.setContent(content); this._hovered = school.npsn;
    }
    this._tooltip.setLatLng(event.latlng).addTo(this._map);
  },
  _leave() { if (this._tooltip && this._map) this._map.removeLayer(this._tooltip); this._hovered = null; },
  _click(event) { const school = this._hit(event.containerPoint); if (school) { this._leave(); this._onSelect(school); } },
});

export const schoolCanvasLayer = (onSelect) => new SchoolCanvas(onSelect);
