import { useMemo } from 'react';
import { levelColors } from '../lib/vervalMap.js';
import { progressBands, summarizeSchools } from '../lib/vervalSummary.js';

const number = new Intl.NumberFormat('id-ID');

export default function VervalSummary({ schools, total, levelTotals, loading, incomplete, level, filters, onChoose }) {
  const groups = useMemo(() => summarizeSchools(schools), [schools]);
  const levels = [...new Set([...Object.keys(levelColors), ...groups.level.keys()])].map((value) => [value, value === '__missing__' ? 'Belum ada data' : value]);
  const programs = [...new Set(['REVIT', 'USB', ...groups.program.keys()])].map((value) => [value,
    value === 'REVIT' ? 'Revitalisasi' : value === 'USB' ? 'Unit Sekolah Baru' : value === '__missing__' ? 'Belum ada data' : value]);
  const categories = [...new Set(['Bencana', '3T atau Afirmasi', 'Reguler', 'TNI', ...groups.category.keys()])].map((value) => [value, value === '__missing__' ? 'Belum ada data' : value]);
  const sections = [['level', 'Jenjang', levels], ['program', 'Jenis program', programs], ['category', 'Kategori sekolah', categories], ['progress', 'Progres pembangunan', progressBands]];
  return <aside className="verval-summary" aria-labelledby="verval-summary-title">
    <header><h3 id="verval-summary-title">Ringkasan sekolah</h3><p className="muted small">{number.format(total)} sekolah sesuai cakupan{loading ? ' · data sedang dimuat' : incomplete ? ' · data belum lengkap' : ''}</p></header>
    {sections.map(([group, title, values]) => <section key={group} className="verval-summary-group" aria-label={title}>
      <h4>{title}</h4>
      {group === 'level' && <p className="verval-summary-note">Jumlah seluruh jenjang di wilayah ini. Klik untuk mengganti jenjang.</p>}
      {values.map(([value, label]) => {
        const count = (group === 'level' ? levelTotals : groups[group]).get(value) || 0;
        const denominator = group === 'level' ? [...levelTotals.values()].reduce((sum, value) => sum + value, 0) : total;
        const active = (group === 'level' ? level : filters[group]) === value;
        return <button key={value} type="button" className="verval-summary-row" aria-pressed={active}
          aria-label={`${title}: ${label}, ${number.format(count)} sekolah`} disabled={value === '__missing__'} onClick={() => onChoose(group, value)}>
          <span className="verval-summary-label">{group === 'level' && <i style={{ background: levelColors[value] || '#8696ad' }} />}{label}</span>
          <span className="verval-summary-track" aria-hidden="true"><span style={{ width: `${Math.min(100, count / Math.max(denominator, 1) * 100)}%`, background: group === 'level' ? levelColors[value] : undefined }} /></span>
          <b>{number.format(count)}</b>
        </button>;
      })}
    </section>)}
  </aside>;
}
