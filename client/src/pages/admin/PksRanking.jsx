import { useEffect, useState } from 'react';
import LoRepresentation from '../../components/LoRepresentation.jsx';
import { personName } from '../../lib/personName.js';
import { rankPksOwners } from '../../lib/pksRanking.js';
import AttendanceRanking from './AttendanceRanking.jsx';

const percent = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const number = new Intl.NumberFormat('id-ID');
const sourceStages = [
  { title: 'BIODATA', metrics: [
    ['belum_login', 'Belum login'], ['bio_belum', 'Belum mengisi biodata'],
    ['bio_proses', 'Proses mengisi biodata'], ['bio_tunggu', 'Menunggu verifikasi biodata'],
    ['bio_ok', 'Sudah verifikasi biodata'],
  ] },
  { title: 'RAB', metrics: [['sepakat_rab', 'Sepakat RAB'], ['ba', 'TTD BA']] },
  { title: 'PKS', metrics: [
    ['pks', 'TTE Kepsek PKS'], ['pks_ppk', 'TTE PPK PKS'], ['meterai', 'E-Meterai'],
  ] },
];

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
      const index = stages.indexOf(status.stage);
      if (index < 0) continue;
      metrics[status.stage]++;
      stageSum += index;
      scored++;
    }
    const overall = scored ? 100 * stageSum / (scored * (stages.length - 1)) : null;
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
  sourceRankingLoading, onLoadSourceRanking, onReloadSourceRanking, verifierMode = false, onShowSchools,
}) {
  const [selectedTab, setTab] = useState('progress');
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
      {!verifierMode && <button aria-pressed={tab === 'attendance'} onClick={() => setTab('attendance')}>Absensi</button>}
    </div>
    {tab === 'attendance' ? <AttendanceRanking venue={venue} query={query} owner={owner} facilitatorLabel="verifikator" compact /> : tab === 'bimtek' ? <>
      <details className="pks-overall-help">
        <summary>Cara hitung <b>Point Progress</b></summary>
        <p>Sekolah dicocokkan dengan data Revit berdasarkan NPSN. Point Progress adalah rata-rata skor sekolah binaan yang tahapnya dikenali di Revit.</p>
        <p>Ada 10 tahap dengan poin 0 sampai 9. Belum login bernilai 0 poin, Belum mengisi biodata 1 poin, Proses mengisi biodata 2 poin, Menunggu verifikasi biodata 3 poin, dan seterusnya hingga E-Meterai 9 poin.</p>
        <p><strong>Rumus</strong> = jumlah poin seluruh sekolah yang dihitung ÷ (jumlah sekolah yang dihitung × 9) × 100%.</p>
        <p><strong>Contoh</strong> — dari 28 sekolah, 2 belum mengisi biodata, 6 sedang mengisi, dan 20 menunggu verifikasi. Skornya ((2 × 1) + (6 × 2) + (20 × 3)) ÷ (28 × 9) × 100% = 29,4% setelah dibulatkan.</p>
        <p>Persentase di samping tiap tahap menunjukkan bagian dari seluruh sekolah binaan yang berada pada tahap tersebut. Peringkat ditentukan dari skor sebelum pembulatan, dan skor yang sama mendapat peringkat yang sama.</p>
      </details>
      {sourceRankingLoading && <p role="status">Mengambil data Revit dan menghitung {title.toLowerCase()}…</p>}
      {sourceRankingError && <div className="alert alert--err" role="alert">{sourceRankingError} <button className="btn btn--sm" onClick={onReloadSourceRanking}>Coba lagi</button></div>}
      {!sourceRankingLoading && sourceRanking && <div className="pks-bimtek-owners">
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
      </div>}
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
