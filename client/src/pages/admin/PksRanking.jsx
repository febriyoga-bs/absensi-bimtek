import { progressGroups, progressLabels, hasProgressStage, progressScore } from '../../../../shared/pksProgress.js';
import { useEffect, useState } from 'react';
import LoRepresentation from '../../components/LoRepresentation.jsx';
import { personName } from '../../lib/personName.js';
import { rankPksOwners } from '../../lib/pksRanking.js';
import AttendanceRanking from './AttendanceRanking.jsx';

const percent = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const number = new Intl.NumberFormat('id-ID');
const sourceStages = progressGroups.map(group => ({ title: group.label === 'Biodata' ? 'BIODATA' : group.label, metrics: progressLabels.filter(([key]) => group.metrics.includes(key)) }));

export function VerifierRankingTable({ rows, onShowSchools }) {
  const metrics = sourceStages.flatMap(group => group.metrics);
  const countCell = (row, metric, value) => onShowSchools
    ? <button type="button" className="pks-progress-count" aria-label={`Lihat sekolah ${row.name}: ${metric === 'total' ? 'Total sekolah' : progressLabels.find(([key]) => key === metric)?.[1]}`} onClick={() => onShowSchools(row, metric)}><strong>{number.format(value)}</strong></button>
    : <strong>{number.format(value)}</strong>;
  return <div className="pks-verifier-ranking-table-wrap" role="region" aria-label="Tabel peringkat verifikator" tabIndex={0}>
    <table className="pks-progress-table pks-verifier-ranking-table">
      <colgroup><col className="pks-rank-column" /><col className="pks-name-column" /><col className="pks-venue-column" /><col className="pks-point-column" /><col />{metrics.map(([key]) => <col key={key} />)}</colgroup>
      <thead>
        <tr><th rowSpan={2} scope="col">#</th><th rowSpan={2} scope="col">Verifikator</th><th rowSpan={2} scope="col">Venue</th><th rowSpan={2} scope="col">Point Progress</th><th rowSpan={2} scope="col">Total sekolah</th>{progressGroups.map(group => <th key={group.label} scope="colgroup" colSpan={group.metrics.length} className={group.className}>{group.label}</th>)}</tr>
        <tr>{metrics.map(([key, label], index) => <th key={key} scope="col">{index + 1}. {label}</th>)}</tr>
      </thead>
      <tbody>{rows.map(row => <tr key={`${row.venue}:${row.name}`}>
        <td>{row.rank ?? '-'}</td><th scope="row">{personName(row.name)}<LoRepresentation name={row.name} /></th><td>{row.venue}</td>
        <td><strong>{row.overall == null ? '-' : `${percent.format(row.overall)}%`}</strong></td>
        <td>{countCell(row, 'total', row.total)}</td>
        {metrics.map(([key]) => { const count = row.metrics[key] ?? 0; return <td key={key}>{countCell(row, key, count)}<small>{row.total ? `${Math.round(count * 100 / row.total)}%` : '-'}</small></td>; })}
      </tr>)}</tbody>
    </table>
    {!rows.length && <p className="muted">Tidak ada verifikator yang cocok dengan filter.</p>}
  </div>;
}

export function rankVerifiers(verifiers, schools, statuses) {
  const stages = sourceStages.flatMap(group => group.metrics.map(([key]) => key));
  const normalize = name => String(name || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const ranked = verifiers.map(verifier => {
    const assigned = new Map(schools.filter(school => school.venue === verifier.venue
      && normalize(school.facilitator) === normalize(verifier.name)
      && verifier.los.includes(school.lo)).map(school => [String(school.npsn), school]));
    const metrics = Object.fromEntries(stages.map(stage => [stage, 0]));
    let matched = 0, stageSum = 0, scored = 0;
    for (const npsn of assigned.keys()) {
      const status = statuses[npsn];
      if (!status) continue;
      matched++;
      const score = progressScore(status);
      if (score == null) continue;
      for (const metric of stages) if (hasProgressStage(status, metric)) metrics[metric]++;
      stageSum += score;
      scored++;
    }
    const overall = scored ? stageSum / scored : null;
    return { ...verifier, schools: [...assigned.values()], matched, total: assigned.size, metrics, overall };
  }).sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1) || a.name.localeCompare(b.name, 'id'));
  let rank = 0;
  return ranked.map((row, index) => {
    if (row.overall !== ranked[index - 1]?.overall) rank = index + 1;
    return { ...row, rank: row.overall == null ? null : rank };
  });
}

export default function PksRanking({
  data, venue, query, owner, onReload, sourceRanking, sourceRankingError,
  sourceRankingLoading, onLoadSourceRanking, onReloadSourceRanking, verifierMode = false, onShowSchools, publicView = false,
}) {
  const [selectedTab, setTab] = useState('progress');
  const [verifierLayout, setVerifierLayout] = useState('card');
  const tab = verifierMode ? 'bimtek' : selectedTab;
  const title = verifierMode ? 'Peringkat Verifikator' : 'Peringkat LO';
  const rows = rankPksOwners(data.schools, data.lo, venue)
    .filter(row => (!owner || row.name === owner) && personName(row.name).toLocaleLowerCase('id').includes(query));
  const sourceRows = (sourceRanking?.owners || []).filter(row => (!venue || row.venue === venue)
    && (!owner || (verifierMode ? row.los.includes(owner) : row.name === owner))
    && [personName(row.name), row.venue].some(value => value.toLocaleLowerCase('id').includes(query)));

  useEffect(() => {
    if (!verifierMode && tab === 'bimtek' && !sourceRanking && !sourceRankingLoading && !sourceRankingError) onLoadSourceRanking();
  }, [verifierMode, tab, sourceRanking, sourceRankingLoading, sourceRankingError, onLoadSourceRanking]);

  return <section className="pks-ranking" aria-label={title}>
    <header className="pks-ranking__heading">
      <h2>{title}</h2>
      {tab === 'progress' && <button type="button" className="btn btn--sm" onClick={onReload}>Muat ulang</button>}
      {tab === 'bimtek' && <button type="button" className="btn btn--sm" onClick={onReloadSourceRanking}>Muat ulang data Revit</button>}
    </header>
    <div className="pks-tabs" role="group" aria-label="Jenis peringkat LO">
      {!verifierMode && <button aria-pressed={tab === 'progress'} onClick={() => setTab('progress')}>Kelengkapan PKS</button>}
      <button aria-pressed={tab === 'bimtek'} onClick={() => setTab('bimtek')}>Pendampingan BIMTEK</button>
      {!verifierMode && !publicView && <button aria-pressed={tab === 'attendance'} onClick={() => setTab('attendance')}>Absensi</button>}
    </div>
    {tab === 'attendance' ? <AttendanceRanking venue={venue} query={query} owner={owner} facilitatorLabel="verifikator" compact /> : tab === 'bimtek' ? <>
      <details className="pks-overall-help">
        <summary>Cara hitung <b>Point Progress</b></summary>
        <p>Sekolah dicocokkan dengan data Revit berdasarkan NPSN. Point Progress adalah rata-rata skor sekolah binaan yang tahapnya dikenali di Revit.</p>
        <p>Ada sepuluh tahap capaian: Sudah login, Sudah mengisi biodata, Sudah kirim biodata, Sudah verifikasi biodata, Kirim proposal RAB, Sepakat RAB, TTD BA, TTE Kepsek PKS, TTE PPK PKS, dan E-Meterai.</p>
        <p>Setiap tahap yang tercapai bernilai satu poin, maksimal 10 poin. Capaian tiap tahap mengikuti daftar sekolah dari Revit, termasuk ketentuan sekolah dengan beberapa program. Point Progress = rata-rata poin sekolah yang statusnya dikenali, dibagi 10, lalu dikalikan 100%.</p>
        <p>Jumlah per tahap bersifat kumulatif. Sekolah yang mencapai tahap akhir juga masuk ke tahap sebelumnya, sehingga jumlah antartahap tidak dijumlahkan. Setiap NPSN dihitung satu kali pada masing-masing tahap. Skor yang sama mendapat peringkat yang sama.</p>
      </details>
      {sourceRankingLoading && <p role="status">Mengambil data Revit dan menghitung {title.toLowerCase()}…</p>}
      {sourceRankingError && <div className="alert alert--err" role="alert">{sourceRankingError} <button className="btn btn--sm" onClick={onReloadSourceRanking}>Coba lagi</button></div>}
      {verifierMode && <div className="pks-ranking-layout" role="group" aria-label="Tampilan peringkat verifikator">
        <button type="button" aria-pressed={verifierLayout === 'card'} onClick={() => setVerifierLayout('card')}>Card</button>
        <button type="button" aria-pressed={verifierLayout === 'table'} onClick={() => setVerifierLayout('table')}>Tabel</button>
      </div>}
      {sourceRanking && (verifierMode && verifierLayout === 'table' ? <VerifierRankingTable rows={sourceRows} onShowSchools={onShowSchools} /> : <div className="pks-bimtek-owners">
        {sourceRows.map(row => <article key={`${row.venue}:${row.name}`}>
          <div className="pks-overall-heading">
            <h3>
              <span className="pks-rank-badge">#{row.rank ?? '-'}</span>
              <span className="pks-overall-name">
                <span>{personName(row.name)}</span>
                <LoRepresentation name={row.name} />
              </span>
            </h3>
            <strong>{row.overall == null ? '—' : `${percent.format(row.overall)}%`}<small>Point Progress</small></strong>
          </div>
          <progress className="pks-overall-bar" max="100" value={row.overall ?? 0} aria-label={`Progres Revit ${personName(row.name)}`} />
          <p>{row.venue} · {onShowSchools ? <button type="button" className="pks-progress-count" onClick={() => onShowSchools(row, 'total')}>{number.format(row.total)} Sekolah binaan</button> : <>{number.format(row.total)} Sekolah binaan</>}</p>
          <div className="pks-ranking-stages">
            {sourceStages.map(({ title, metrics }) => <section key={title}>
              <h4>{title}</h4>
              <dl>{metrics.map(([key, label]) => {
                const count = row.metrics[key] ?? 0;
                return <div key={key}>
                  <dt>{label}</dt>
                  <dd>{onShowSchools ? <button type="button" className="pks-progress-count" aria-label={`Lihat sekolah ${row.name}: ${label}`} onClick={() => onShowSchools(row, key)}>{number.format(count)}</button> : number.format(count)}<small>{row.total ? ` · ${Math.round(count * 100 / row.total)}%` : ''}</small></dd>
                </div>;
              })}</dl>
            </section>)}
          </div>
        </article>)}
        {!sourceRows.length && <p>Tidak ada {verifierMode ? 'verifikator' : 'LO'} yang cocok dengan filter.</p>}
      </div>)}
    </> : <>
      <p className="pks-ranking__note">Diurutkan berdasarkan persentase sekolah berstatus Lengkap.</p>
      <div className="reporting-ranking" tabIndex={0} aria-label="Peringkat capaian verifikasi sekolah">
        {rows.length ? <ol>{rows.map(row => <li key={`${row.venue}:${row.name}`}>
          <div className="reporting-ranking-name"><b>{row.rank ?? '-'} . {personName(row.name)}<LoRepresentation name={row.name}/></b><strong>{row.ratio == null ? 'Belum ada binaan' : `${percent.format(row.ratio)}%`}</strong></div>
          <progress max={100} value={row.ratio ?? 0} aria-label={`${personName(row.name)}: ${row.completed} dari ${row.total} sekolah lengkap`} />
          <p>{row.completed}/{row.total} sekolah memiliki PKS lengkap · {row.venue}</p>
        </li>)}</ol> : <p>Tidak ada LO yang cocok dengan filter.</p>}
      </div>
    </>}
  </section>;
}
