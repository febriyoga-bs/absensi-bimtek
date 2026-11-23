import {summarizeBimtek} from "../../../../shared/pksBimtek.js";
export function BimtekSummary({schools}) {
  const counts=summarizeBimtek(schools);
  return <section className="pks-bimtek-overview" aria-label="Capaian pendampingan bimtek"><div><h2>Capaian Pendampingan Bimtek</h2><p>Monitoring status hasil pemeriksaan dari dashboard verifikasi. Mengikuti filter venue dan LO.</p></div><dl>{[['total','Sekolah binaan'],['documents','Dokumen lengkap'],['submitted','RAB diajukan'],['followup','Perlu tindak lanjut'],['complete','PKS lengkap']].map(([key,label])=><div key={key}><dt>{label}</dt><dd>{counts[key].toLocaleString('id-ID')}<small>{key!=='total' && ` / ${counts.total.toLocaleString('id-ID')}`}</small></dd></div>)}</dl></section>;
}
