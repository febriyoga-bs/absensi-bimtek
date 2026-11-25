import { HttpError } from './util.js';
import { progressLabels, progressStage } from '../../shared/pksProgress.js';
export const progressSourceUrl = 'https://revitsd.kemendikdasmen.go.id/spab/dashboard-progress?jenis=pks&bimtek=1';
export const progressSchoolUrl = 'https://revitsd.kemendikdasmen.go.id/spab/dashboard-progress/sekolah';
const progressMetrics = progressLabels;
const decodeHtml = (value) => String(value || '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
  .replace(/&ndash;|&#8211;/g, '–').replace(/&mdash;|&#8212;/g, '—')
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const htmlText = (value) => decodeHtml(String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
const parseNumber = (value) => Number(String(value || '').replace(/\./g, '').replace(/,/g, '.').replace(/[^\d.-]/g, '')) || 0;

export function parseProgressSchoolPage(html) {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, row]) => {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(([, cell]) => cell);
    if (cells.length < 4) return null;
    const identity = htmlText(cells[0]);
    const npsn = identity.match(/NPSN\s*(\d{8})/i)?.[1];
    if (!npsn) return null;
    const name = identity.replace(/\s*NPSN\s*\d{8}.*$/i, '').trim();
    return { npsn, name, kabKota: htmlText(cells[1]), hotel: htmlText(cells[2]), status: htmlText(cells[3]) };
  }).filter(Boolean);
  const totalMatch = htmlText(html).match(/\d[\d.]*\s*[–-]\s*\d[\d.]*\s+dari\s+([\d.]+)\s+sekolah/i);
  return { rows, total: totalMatch ? parseNumber(totalMatch[1]) : rows.length };
}

export function parseProgressPage(html) {
  const metricList = [...html.matchAll(/<button\b(?=[^>]*data-progress-open)([^>]*)>([\s\S]*?)<\/button>/gi)]
    .filter(([, attrs]) => /data-hotel=""/i.test(attrs));
  const summary = metricList.map(([, attrs, body]) => {
    const sourceMetric = attrs.match(/data-metric="([^"]+)"/i)?.[1];
    const label = htmlText(body.match(/<span[^>]*>([\s\S]*?)<\/span>/i)?.[1])
      || decodeHtml(attrs.match(/data-title="([^"]*)"/i)?.[1] || '');
    const value = body.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1];
    const percent = body.match(/<span[^>]*text-xs[^>]*>([^<]*%)<\/span>/i)?.[1] || '0%';
    const metric = /total sekolah/i.test(label) ? 'total'
      : ['total', 'tidak_terdata'].includes(sourceMetric) ? sourceMetric : progressStage(label);
    return metric ? { metric, sourceMetric, label, value: parseNumber(htmlText(value)), percent: htmlText(percent) } : null;
  }).filter(Boolean);

  const hotels = [...html.matchAll(/<tr\b[^>]*class="[^"]*hover:bg-soft[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, row]) => {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(([, cell]) => cell);
    if (!cells.length) return null;
    const metrics = Object.fromEntries(progressMetrics.map(([key]) => [key, 0]));
    cells.slice(1).forEach((cell) => {
      const sourceMetric = cell.match(/data-metric="([^"]+)"/i)?.[1];
      const metric = summary.find(item => item.sourceMetric === sourceMetric)?.metric || sourceMetric;
      const buttonValue = cell.match(/<button\b[^>]*>([\s\S]*?)<\/button>/i)?.[1];
      const spanValue = cell.match(/<span[^>]*>([\s\S]*?)<\/span>/i)?.[1];
      if (metric && Object.hasOwn(metrics, metric)) metrics[metric] = parseNumber(htmlText(buttonValue));
      else if (spanValue) {
        const index = cells.indexOf(cell);
        const key = progressMetrics[index - 1]?.[0];
        if (key) metrics[key] = parseNumber(htmlText(spanValue));
      }
    });
    return { hotel: htmlText(cells[0]), metrics };
  }).filter((row) => row?.hotel);

  if (!summary.length || !hotels.length) throw new HttpError(502, 'Struktur data dashboard progress sumber berubah.');
  const updatedAt = html.match(/diperbarui\s*([^<]+)/i)?.[1]?.trim() || null;
  return { source: progressSourceUrl, updatedAt: htmlText(updatedAt), metrics: summary, hotels };
}

