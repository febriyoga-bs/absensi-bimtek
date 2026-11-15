import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { fmtFull } from '../lib/time.js';
import { hasCoordinates, levelColors, matchesSchool, schoolGeoJSON } from '../lib/vervalMap.js';
import './VervalDashboard.css';
import VervalSummary from './VervalSummary.jsx';

const VervalMap = lazy(() => import('./VervalMap.jsx'));
const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const money = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const clearFilters = { search: '', district: '', category: '', program: '', progress: '', year: '', status: '' };
const emptySchools = [];
const emptyProvinces = {};
const schoolsPerPage = 4;

function SchoolDetails({ school, onClose }) {
  const [result, setResult] = useState(null);
  const [revision, setRevision] = useState(0);
  const [photoStage, setPhotoStage] = useState('terakhir');
  useEffect(() => {
    let active = true;
    setResult(null);
    api(`/verval/schools/${encodeURIComponent(school.npsn)}`).then((data) => { if (active) setResult({ data }); })
      .catch((error) => { if (active) setResult({ error: error.message }); });
    return () => { active = false; };
  }, [school.npsn, revision]);
  const photos = result?.data?.foto?.[photoStage]?.photos || [];
  return <aside className="verval-detail" aria-label={`Rincian ${school.nama}`}>
    <div className="verval-detail-head"><span className="verval-eyebrow">Rincian sekolah</span><button type="button" className="btn btn--sm" onClick={onClose}>Tutup</button></div>
    <h3>{school.nama}</h3><p className="muted small">NPSN {school.npsn} · {school.status_sekolah} · {school.jenjang}</p>
    <p>{[school.desa, school.kecamatan].filter(Boolean).join(', ')}</p>
    <dl className="verval-detail-stats">{[
      ['Progres fisik', Number.isFinite(school.progres) ? `${nf.format(school.progres)}%` : 'Belum ada data'],
      ['Nilai bantuan', Number.isFinite(school.nilai_bantuan) ? money.format(school.nilai_bantuan) : 'Belum ada data'],
      ['Tahun', school.tahun || '—'], ['Kategori', school.kategori || '—'],
      ['Peserta didik', school.jumlah_siswa == null ? '—' : nf.format(school.jumlah_siswa)],
      ['Tenaga pendidik', school.jumlah_tendik == null ? '—' : nf.format(school.jumlah_tendik)],
    ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {!hasCoordinates(school) && <p className="muted small">Koordinat sekolah belum tersedia pada sumber.</p>}
    {!result && <p role="status" className="muted">Memuat rincian dan foto…</p>}
    {result?.error && <div role="alert"><p>{result.error}</p><button className="btn btn--sm" onClick={() => setRevision((value) => value + 1)}>Coba lagi</button></div>}
    {result?.data && <>
      <h4>Menu pekerjaan</h4>
      {result.data.menu_volume?.length ? <ul>{result.data.menu_volume.map((menu, i) => <li key={i}>{menu}</li>)}</ul> : <p className="muted small">Belum ada rincian pekerjaan.</p>}
      <div className="verval-photo-tabs" role="group" aria-label="Tahap foto">{['awal', 'terakhir'].map((stage) => <button type="button" className="btn btn--sm" key={stage} aria-pressed={stage === photoStage} onClick={() => setPhotoStage(stage)}>{stage === 'awal' ? 'Foto awal' : 'Foto terbaru'}</button>)}</div>
      {!photos.length && <p className="muted small">Belum ada foto pada tahap ini.</p>}
      <div className="verval-photos">{photos.slice(0, 12).map((photo) => {
        let src;
        try { const url = new URL(photo.display || photo.thumb); if (url.protocol === 'https:' && url.hostname.endsWith('.blob.core.windows.net')) src = url.href; } catch { /* Invalid source URL. */ }
        return src ? <figure key={photo.id}><img src={src} loading="lazy" alt={`${school.nama} · ${photo.angle_label || photo.item || 'Dokumentasi sekolah'}`} /><figcaption>{photo.item} · {photo.angle_label}</figcaption></figure> : null;
      })}</div>
      {photos.length > 12 && <p className="muted small">Menampilkan 12 dari {nf.format(photos.length)} foto sumber.</p>}
    </>}
  </aside>;
}

export default function VervalDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [level, setLevel] = useState('SD');
  const [province, setProvince] = useState('');
  const [view, setView] = useState('summary');
  const [filters, setFilters] = useState(clearFilters);
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const partitionCache = useRef(new Map());
  const [partitionState, setPartitionState] = useState({ key: '', rows: [], completed: 0, failed: 0 });
  const detailed = Boolean(province || view === 'schools' || Object.values(filters).some(Boolean));

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    api('/verval/overview').then((result) => { if (active) setData(result); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  const parts = useMemo(() => (data?.parts || []).filter((part) => (!level || part.level === level) && (!province || part.province === province)), [data, level, province]);
  const partitionKeys = useMemo(() => parts.filter((part) => part.count > 0).map((part) => `${part.level}-${part.province}`), [parts]);
  const partitionKey = partitionKeys.join(',');

  useEffect(() => {
    if (!data) return;
    let active = true, next = 0, completed = 0, failed = 0;
    const rows = new Map();
    const publish = () => { if (active) setPartitionState({ key: partitionKey, rows: [...rows.values()], completed, failed }); };
    async function worker() {
      while (active && next < partitionKeys.length) {
        const key = partitionKeys[next++];
        try {
          let schools = partitionCache.current.get(key);
          if (!schools) { const result = await api(`/verval/parts/${encodeURIComponent(key)}`); schools = result.rows; partitionCache.current.set(key, schools); }
          if (!active) return;
          for (const school of schools) rows.set(school.npsn, school);
        } catch { if (active) failed += 1; }
        if (active) { completed += 1; publish(); }
      }
    }
    publish();
    Promise.all(Array.from({ length: Math.min(3, partitionKeys.length) }, worker));
    return () => { active = false; };
  }, [data, partitionKey, partitionKeys, revision]);

  const schools = partitionState.key === partitionKey ? partitionState.rows : emptySchools;
  const filtered = useMemo(() => schools.filter((school) => matchesSchool(school, filters)), [schools, filters]);
  const coordinates = useMemo(() => filtered.filter(hasCoordinates), [filtered]);
  const loadingSchools = !data || partitionState.key !== partitionKey || partitionState.completed < partitionKeys.length;
  const failedPartitions = partitionState.key === partitionKey ? partitionState.failed : 0;
  const totalsReady = !loadingSchools && !failedPartitions;
  const total = detailed ? filtered.length : parts.reduce((sum, part) => sum + part.count, 0);
  const expectedSchools = parts.reduce((sum, part) => sum + part.count, 0);
  const levelTotals = useMemo(() => {
    const totals = new Map();
    for (const part of data?.parts || []) {
      if (!province || part.province === province) totals.set(part.level, (totals.get(part.level) || 0) + part.count);
    }
    return totals;
  }, [data, province]);
  const loadedSchools = Math.min(schools.length, expectedSchools);
  const provinces = data?.provinces || emptyProvinces;
  const provinceOptions = Object.entries(provinces).sort((a, b) => a[1].localeCompare(b[1], 'id'));
  const options = (field) => [...new Set(schools.map((school) => school[field]).filter((value) => value != null && value !== ''))].sort();
  const progressSchools = filtered.filter((school) => Number.isFinite(school.progres));
  const average = progressSchools.length ? progressSchools.reduce((sum, school) => sum + school.progres, 0) / progressSchools.length : null;
  const assistanceSchools = filtered.filter((school) => Number.isFinite(school.nilai_bantuan));
  const assistance = assistanceSchools.length ? assistanceSchools.reduce((sum, school) => sum + school.nilai_bantuan, 0) : null;
  useEffect(() => { setPage(1); }, [filters, level, province]);
  const changeProvince = useCallback((code) => { setProvince(code); setFilters((current) => ({ ...current, district: '' })); setSelected(null); }, []);
  const updateFilter = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.value }));
  function reset() { setProvince(''); setLevel('SD'); setFilters(clearFilters); setSelected(null); setView('summary'); }
  function refresh() { partitionCache.current.clear(); setRevision((value) => value + 1); }
  function chooseSummary(group, value) {
    setSelected(null);
    if (group === 'level') { setLevel((current) => current === value ? '' : value); return; }
    setFilters((current) => ({ ...current, [group]: current[group] === value ? '' : value }));
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(schoolGeoJSON(filtered))], { type: 'application/geo+json' }));
    const link = document.createElement('a'); link.href = url; link.download = `sekolah-verval-${level || 'semua'}-${province || 'indonesia'}.geojson`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const advancedSelect = (key, label, choices) => <label key={key}>{label}<select value={filters[key]} onChange={updateFilter(key)}><option value="">Semua {label.toLowerCase()}</option>{choices.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>;

  return <section className="landing-dashboard panel verval-dashboard" aria-labelledby="verval-title">
    <header className="verval-header"><div><span className="verval-eyebrow">Verval Kemendikdasmen</span><h2 id="verval-title">Peta Revitalisasi</h2><p className="muted">Satuan Pendidikan {level || 'Semua Jenjang'} · {province ? provinces[province] : 'Indonesia'}</p></div>
      <div className="verval-header-meta">{data && <span>Data per {fmtFull(data.updated_at)}</span>}<button type="button" className="btn btn--sm" disabled={loading} onClick={refresh}>Muat ulang</button></div>
    </header>
    {loading && <p role="status" className="muted">Memuat data Verval…</p>}
    {error && <p className="alert alert--err" role="alert">{error}</p>}
    <div className="verval-toolbar">
      <label className="verval-search"><span>Cari sekolah</span><input type="search" value={filters.search} placeholder="Nama sekolah, NPSN, atau kecamatan" onChange={updateFilter('search')} /></label>
      <label><span>Jenjang</span><select value={level} onChange={(event) => { setLevel(event.target.value); setSelected(null); setFilters(clearFilters); }}><option value="">Semua jenjang</option>{(data?.levels || [{ kode: 'SD', nama: 'SD' }]).map(({ kode, nama }) => <option key={kode} value={kode}>{nama}</option>)}</select></label>
      <label><span>Provinsi</span><select value={province} onChange={(event) => changeProvince(event.target.value)}><option value="">Semua provinsi</option>{provinceOptions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      <button type="button" className="btn btn--sm" onClick={reset}>Reset filter</button>
    </div>
    <details className="verval-more-filters"><summary>Filter lanjutan</summary><div className="verval-filter-grid">
      {advancedSelect('district', 'Kabupaten/kota', Object.entries(data?.districts || {}).filter(([code]) => !province || code.startsWith(`${province}.`)))}
      {advancedSelect('category', 'Kategori', [...new Set(['Reguler', 'Bencana', 'Aspirasi', ...options('kategori')])].map((item) => [item, item]))}
      {advancedSelect('program', 'Program', [['REVIT', 'Revitalisasi'], ['USB', 'Unit Sekolah Baru']])}
      {advancedSelect('progress', 'Progres fisik', [['0:25', '0–25%'], ['25.000001:50', '26–50%'], ['50.000001:75', '51–75%'], ['75.000001:94.999999', '76–94%'], ['95:100', '95–100%'], ['none', 'Belum ada data']])}
      {advancedSelect('year', 'Tahun', options('tahun').map((item) => [item, item]))}
      {advancedSelect('status', 'Status sekolah', [['Negeri', 'Negeri'], ['Swasta', 'Swasta']])}
    </div></details>
    <div className="verval-kpis">
      <div><span>Sekolah {detailed ? 'sesuai filter' : 'terdata'}</span><b>{nf.format(total)}</b><small>{loadingSchools ? 'Data sekolah sedang dimuat' : failedPartitions ? 'Sebagian data belum tersedia' : 'Satuan pendidikan'}</small></div>
      <div><span>Nilai bantuan</span><b aria-live="polite">{loadingSchools ? 'Memuat…' : failedPartitions ? 'Belum lengkap' : assistance !== null ? money.format(assistance) : 'Belum ada data'}</b><small>{totalsReady ? `Total bantuan dari ${nf.format(assistanceSchools.length)} sekolah sesuai cakupan` : 'Menunggu seluruh data sekolah agar total akurat'}</small></div>
      <div><span>Rata-rata progres</span><b aria-live="polite">{loadingSchools ? 'Memuat…' : failedPartitions ? 'Belum lengkap' : average !== null ? `${nf.format(average)}%` : 'Belum ada data'}</b><small>{totalsReady ? `${nf.format(progressSchools.length)} sekolah memiliki data progres` : 'Dihitung setelah seluruh data sekolah dimuat'}</small></div>
      <div><span>Lokasi di peta</span><b>{detailed ? nf.format(coordinates.length) : nf.format(new Set(parts.filter((part) => part.count > 0).map((part) => part.province)).size)}</b><small>{detailed ? `${nf.format(filtered.length - coordinates.length)} sekolah tanpa koordinat valid` : 'Provinsi dengan sekolah terdata'}</small></div>
    </div>
    <div className="verval-view-bar"><div role="group" aria-label="Tampilan peta sekolah"><button type="button" aria-pressed={!detailed} onClick={() => { setView('summary'); setProvince(''); setFilters(clearFilters); setSelected(null); }}>Ringkasan wilayah</button><button type="button" aria-pressed={detailed} onClick={() => setView('schools')}>Semua sekolah</button></div>
      <button type="button" className="btn btn--sm" disabled={!detailed || !totalsReady || !coordinates.length} onClick={download}>Unduh GeoJSON sekolah</button>
    </div>
    {loadingSchools && data && <div className="verval-load-progress" role="status">
      <div><strong>Memuat data sekolah…</strong><span>{nf.format(loadedSchools)} dari {nf.format(expectedSchools)} sekolah · {partitionState.key === partitionKey ? partitionState.completed : 0}/{partitionKeys.length} wilayah</span></div>
      <progress aria-label="Pemuatan data sekolah" value={loadedSchools} max={Math.max(expectedSchools, 1)} />
    </div>}
    {failedPartitions > 0 && <p role="alert" className="alert alert--warn">{failedPartitions} bagian wilayah gagal dimuat. Data yang tampil belum lengkap. <button type="button" className="btn btn--sm" onClick={refresh}>Coba lagi</button></p>}
    <div className={`verval-workspace ${selected ? 'has-detail' : 'has-summary'}`}><div className="verval-map-column">
      <Suspense fallback={<div className="verval-map-loading" role="status">Menyiapkan peta Indonesia…</div>}><VervalMap schools={filtered} parts={parts} provinces={provinces} province={province} detailed={detailed} selected={selected} onSelect={setSelected} onProvince={changeProvince} /></Suspense>
      <div className="verval-legend">{Object.entries(levelColors).map(([name, color]) => <span key={name}><i style={{ background: color }} />{name}</span>)}<span>Isian bangunan = progres pembangunan</span><span>Bendera = selesai 100%</span><span>Garis putus-putus = progres belum tersedia</span></div>
    </div>{selected ? <SchoolDetails key={selected.npsn} school={selected} onClose={() => setSelected(null)} />
      : <VervalSummary schools={filtered} total={total} levelTotals={levelTotals} loading={loadingSchools} incomplete={Boolean(failedPartitions)} level={level} filters={filters} onChoose={chooseSummary} />}</div>
    <details className="verval-school-list" open={detailed}><summary>{detailed ? 'Daftar sekolah sesuai filter' : 'Jumlah sekolah per provinsi'} · {nf.format(total)}</summary>
      {detailed ? <>
        {!filtered.length && !loadingSchools && <p className="muted">Tidak ada sekolah yang sesuai filter.</p>}
        <div className="verval-list-grid">{filtered.slice((page - 1) * schoolsPerPage, page * schoolsPerPage).map((school) => <button type="button" key={school.npsn} className={selected?.npsn === school.npsn ? 'is-selected' : ''} onClick={() => setSelected(school)}><span className="verval-school-dot" style={{ background: levelColors[school.jenjang] || '#2563eb' }} /><span><b>{school.nama}</b><small>{school.npsn} · {data?.districts?.[school.kode_kab] || school.kecamatan}</small></span><strong>{Number.isFinite(school.progres) ? `${nf.format(school.progres)}%` : '—'}</strong></button>)}</div>
        {filtered.length > schoolsPerPage && <div className="verval-pagination"><button type="button" className="btn btn--sm" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Sebelumnya</button><span>Halaman {page}/{Math.ceil(filtered.length / schoolsPerPage)}</span><button type="button" className="btn btn--sm" disabled={page * schoolsPerPage >= filtered.length} onClick={() => setPage((value) => value + 1)}>Berikutnya</button></div>}
      </> : <div className="verval-province-grid">{provinceOptions.map(([code, name]) => <button key={code} type="button" onClick={() => changeProvince(code)}><span>{name}</span><b>{nf.format(parts.filter((part) => part.province === code).reduce((sum, part) => sum + part.count, 0))}</b></button>)}</div>}
    </details>
    <p className="verval-attribution">Data sekolah: Verval Kemendikdasmen. Batas wilayah: geoBoundaries IDN ADM2 (BPS / WFP / OCHA ROAP), CC BY 3.0 IGO</p>
  </section>;
}
