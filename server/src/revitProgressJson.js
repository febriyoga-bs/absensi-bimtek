import { readRevitHtml } from './revitHttp.js';
import { progressLabels, progressStages } from '../../shared/pksProgress.js';
import { HttpError } from './util.js';

const progressExportUrl = (() => {
  const url = new URL('https://revitsd.kemendikdasmen.go.id/spab/dashboard-progress/export');
  url.search = new URLSearchParams({ jenis: 'pks', bimtek: '1', metric: 'total', mode: 'sudah', page: '1' });
  for (const hotel of ['Atria Tangerang', 'Lumire Jakarta', 'Novotel Mangga Dua']) {
    url.searchParams.append('hotels[]', hotel);
  }
  return url.toString();
})();

export function parseRevitJsonPages(pages) {
  const first = pages[0];
  if (!first || !Number.isSafeInteger(first.last_page) || first.last_page !== pages.length ||
      pages.some(page => page.version !== first.version || page.last_page !== first.last_page || !Array.isArray(page.schools))) {
    throw new HttpError(502, 'Data Revit berubah saat dibaca. Coba muat ulang.');
  }
  const items = pages.flatMap(page => page.schools);
  const npsns = new Set();
  const schools = items.map(item => {
    const npsn = String(item.npsn ?? '');
    if (!/^\d{8}$/.test(npsn) || npsns.has(npsn) || !item.hotel || !Array.isArray(item.reached))
      throw new HttpError(502, 'Daftar sekolah JSON Revit tidak valid atau berulang.');
    npsns.add(npsn);
    const achieved = progressStages.filter(stage => item.reached.includes(stage === 'rab_kirim' ? 'kirim_rab' : stage));
    const stage = achieved.at(-1) || (item.metrics?.includes('tidak_terdata') ? 'tidak_terdata' : 'belum_login');
    return {
      npsn, name: String(item.nama || ''), kabKota: String(item.kabkota || ''),
      hotel: String(item.hotel), verifier: String(item.owners?.biodata?.name || ''),
      stage, achieved, status: first.labels?.[stage] || stage,
    };
  });
  const buildMetrics = rows => Object.fromEntries(progressLabels.map(([metric]) => [metric,
    metric === 'total' ? rows.length : rows.filter(row => metric === 'tidak_terdata'
      ? row.stage === metric : row.achieved.includes(metric)).length]));
  const totals = buildMetrics(schools);
  const hotels = [...new Set(schools.map(row => row.hotel))].map(hotel => ({
    hotel, metrics: buildMetrics(schools.filter(row => row.hotel === hotel)),
  }));
  return {
    source: progressExportUrl, updatedAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
    schools, hotels,
    metrics: progressLabels.map(([metric, label]) => ({
      metric, sourceMetric: metric === 'rab_kirim' ? 'kirim_rab' : metric,
      label, value: totals[metric],
      percent: totals.total ? `${Math.round(totals[metric] * 100 / totals.total)}%` : '0%',
    })),
  };
}

export async function loadRevitProgressJson({ read = readRevitHtml } = {}) {
  // Revit's export response is JSON with up to 500 schools per page, not XLSX.
  // Version checks avoid silently mixing a live update across three pages.
  for (let attempt = 0; attempt < 2; attempt++) {
    const pages = [];
    const url = new URL(progressExportUrl);
    const fetchPage = async page => {
      url.searchParams.set('page', String(page));
      const data = JSON.parse(await read(url.toString()));
      if (!Array.isArray(data.schools) || !Number.isSafeInteger(data.last_page) ||
          data.last_page < 1 || data.last_page > 20) throw new HttpError(502, 'Format export JSON Revit tidak valid.');
      return data;
    };
    pages.push(await fetchPage(1));
    const remaining = Array.from({ length: pages[0].last_page - 1 }, (_, index) => index + 2);
    pages.push(...await Promise.all(remaining.map(fetchPage)));
    if (pages.every(page => page.version === pages[0].version)) return parseRevitJsonPages(pages);
  }
  throw new HttpError(503, 'Data Revit sedang diperbarui. Coba lagi sebentar.');
}
