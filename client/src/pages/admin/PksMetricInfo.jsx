import {useEffect,useRef,useState,useId} from 'react';

const explanations={
  total:{title:'Sekolah binaan',text:'Jumlah sekolah yang ditugaskan kepada LO pada venue ini. Setiap NPSN dihitung satu kali.',rule:'Pada ringkasan utama, jumlah mengikuti filter venue dan LO yang dipilih.'},
  documents:{title:'Dokumen lengkap / siap',text:'Jumlah sekolah yang status hasil pemeriksaan dokumennya sudah Lengkap. Pemeriksaan dan checklist rinci dilakukan pada dashboard verifikasi.',rule:'Status Belum dicatat, Belum lengkap, Menunggu verifikasi, dan Perlu perbaikan belum masuk capaian ini.'},
  submitted:{title:'RAB diajukan',text:'Jumlah sekolah yang Rencana Anggaran Biayanya sudah diajukan, termasuk yang menunggu reviu, perlu perbaikan, diajukan kembali, atau sudah sesuai hasil reviu.',rule:'Angka ini menunjukkan RAB sudah memasuki proses pemeriksaan, bukan berarti seluruh RAB telah disetujui.'},
  reviewed:{title:'RAB sesuai',text:'Jumlah sekolah yang RAB-nya tercatat Sesuai hasil reviu berdasarkan hasil pemeriksaan verifikator.',rule:'RAB yang baru diajukan atau masih perlu perbaikan belum termasuk dalam angka ini.'},
  followup:{title:'Perlu tindak lanjut',text:'Jumlah sekolah yang memiliki status Perlu perbaikan pada dokumen, RAB, atau PKS.',rule:'Sekolah dengan beberapa perbaikan tetap dihitung satu kali. Verifikator melakukan pemeriksaan, mengisi checklist, dan menindaklanjuti hasilnya pada dashboard verifikasi. LO membantu serta mengingatkan verifikator yang didampinginya.'},
  complete:{title:'PKS lengkap',text:'Jumlah sekolah yang Perjanjian Kerja Sama (PKS)-nya tercatat berstatus Lengkap.',rule:'Status ini khusus untuk PKS. Kelengkapan dokumen dan hasil reviu RAB ditampilkan sebagai indikator tersendiri.'},
};

function Explanation({metric,context,schoolLevel,onClose}) {
  const ref=useRef(null),titleId=useId(),info=explanations[metric];
  useEffect(()=>{ref.current.showModal();},[]);
  return <dialog ref={ref} className="pks-dialog pks-metric-dialog" aria-labelledby={titleId} onCancel={onClose}>
    <header><div><h2 id={titleId}>{info.title}</h2>{context && <p>{context}</p>}</div><button type="button" className="pks-dialog__close" aria-label="Tutup penjelasan" onClick={onClose}>×</button></header>
    <div className="pks-dialog__body"><p>{info.text}</p><p>{info.rule}</p>{!schoolLevel && metric!=='total' && <div className="pks-metric-formula"><b>Cara membaca angka</b><p>Contoh: 12 / 40 (30%) berarti 12 dari 40 sekolah binaan memenuhi indikator ini.</p><p>Persentase = sekolah yang memenuhi indikator ÷ total sekolah binaan × 100%.</p></div>}{!schoolLevel && <p className="pks-form-hint">Angka 0 berarti belum ada sekolah yang tercatat memenuhi indikator.</p>}</div>
    <div className="pks-metric-role-note">Pemeriksaan dan pembaruan status merupakan tugas verifikator. Dashboard ini membantu LO memantau progres dan mengingatkan verifikator.</div>
    <footer><button type="button" className="btn btn--primary" onClick={onClose}>Mengerti</button></footer>
  </dialog>;
}

export default function PksMetricInfo({metric,label,context,schoolLevel=false,children}) {
  const [open,setOpen]=useState(false);
  return <div className="pks-metric-item"><dt><button type="button" className="pks-metric-trigger" aria-haspopup="dialog" aria-label={`Penjelasan ${label}`} onClick={()=>setOpen(true)}>{label}<span aria-hidden="true">ⓘ</span></button></dt><dd>{children}{open && <Explanation metric={metric} context={context} schoolLevel={schoolLevel} onClose={()=>setOpen(false)}/>}</dd></div>;
}
