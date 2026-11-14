import { levelColors } from './vervalMap.js';

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
let sequence = 0;

export function markerProgress(school) {
  return Number.isFinite(school.progres) ? Math.max(0, Math.min(100, school.progres)) : null;
}

export function schoolMarkerMarkup(school, { selected = false, animate = false } = {}) {
  const color = levelColors[school.jenjang] || '#2563eb';
  const progress = markerProgress(school);
  const clip = `verval-house-${++sequence}`;
  const shape = 'M10 25 24 12 38 25V45H10Z';
  const label = progress === null ? '—' : `${number.format(progress)}%`;
  return `<span class="verval-school-visual${animate ? ' is-animating' : ''}" data-progress="${progress ?? 'unknown'}">
    <svg viewBox="0 0 48 62" aria-hidden="true" style="--building-color:${color};--building-progress:${(progress ?? 0) / 100}">
      <defs><clipPath id="${clip}"><path d="${shape}"/></clipPath></defs>
      ${selected ? '<circle class="verval-selection-ring" cx="24" cy="28" r="22" fill="none" stroke="#1766ab" stroke-width="2.5"/>' : ''}
      <path d="${shape}" fill="#fff"/>
      <g clip-path="url(#${clip})"><rect class="verval-building-fill" x="8" y="12" width="32" height="33" fill="${color}"/></g>
      <path d="${shape}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"${progress === null ? ' stroke-dasharray="3 2"' : ''}/>
      <path d="M21 45V34h7v11M15 28h4m11 0h4" fill="none" stroke="#28425e" stroke-width="1.5"/>
      ${progress === 100 ? `<path d="M25 12V3m0 0h9v5h-9" fill="${color}" stroke="${color}" stroke-width="1.5"/>` : ''}
      ${selected ? `<rect x="6" y="49" width="36" height="12" rx="6" fill="#174a7c"/><text x="24" y="57.8" text-anchor="middle" fill="#fff" font-size="9" font-weight="700">${label}</text>` : ''}
    </svg>
  </span>`;
}
