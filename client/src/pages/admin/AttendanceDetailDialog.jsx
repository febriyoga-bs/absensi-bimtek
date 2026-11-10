import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { formatRoom } from '../../lib/room.js';

const number = new Intl.NumberFormat('id-ID');

function attendanceLabel(person) {
  if (!person.registered) return 'Profil absensi belum tersedia';
  if (person.status === 'valid') return 'Sudah absen';
  if (person.status === 'review') return 'Sudah absen · perlu dicek';
  if (person.status === 'berhalangan') return 'Mundur/Berhalangan Hadir';
  return 'Belum absen';
}

export default function AttendanceDetailDialog({ details, onClose }) {
  const [detailResult, setDetailResult] = useState(null);
  const dialog = useRef(null);

  useEffect(() => {
    if (!details) return;
    if (!dialog.current.open) dialog.current.showModal();
    let current = true;
    setDetailResult(null);
    api(details.path, { admin: true })
      .then((entries) => { if (current) setDetailResult({ entries }); })
      .catch(() => { if (current) setDetailResult({ error: true }); });
    return () => { current = false; };
  }, [details]);

  const detailEntries = detailResult?.entries ?? details?.entries;
  return (
      <dialog ref={dialog} className="assignment-dialog" aria-labelledby="assignment-detail-title"
        onClose={onClose}>
        {details && <>
          <header>
            <div>
              <h3 id="assignment-detail-title">Daftar {details.label}</h3>
              <p className="muted small">{details.subtitle}</p>
              {detailEntries && <span className="assignment-detail-count">{number.format(detailEntries.length)} hasil</span>}
            </div>
            <form method="dialog"><button className="btn btn--sm" autoFocus><Icon name="x" size={16} />Tutup</button></form>
          </header>
          {!detailResult && <p className="muted small" role="status">Memuat status absensi…</p>}
          {detailResult?.error && <p className="alert alert--warn" role="status">Status absensi gagal dimuat. Tutup dan buka kembali daftar untuk mencoba lagi.</p>}
          {detailResult?.entries?.length > 0 && <p className="muted small">Status dari semua sesi di venue ini.</p>}
          {detailEntries?.length > 0 && <ol>
            {detailEntries.map((entry, index) => (
              <li key={entry.npsn || index}>
                <b>{entry.name}</b>
                <div className="muted small">
                  {[entry.npsn && `NPSN ${entry.npsn}`, entry.institution, formatRoom(entry.room)].filter(Boolean).join(' · ')}
                </div>
                {entry.people?.map((person) => (
                  <div key={`${person.position || ""}:${person.name}`} className="assignment-person">
                    {person.position && <span className="small"><b>{person.position}</b> · {person.name}</span>}
                    <span className={`tag ${person.status === 'valid' ? 'tag--open' : person.status === 'review' ? 'tag--venue' : 'tag--off'}`}>
                      {attendanceLabel(person)}
                    </span>
                  </div>
                ))}
                {entry.people?.length === 0 && <small className="muted">Nama peserta belum tersedia.</small>}
              </li>
            ))}
          </ol>}
          {detailEntries?.length === 0 && <p className="muted">Tidak ada {details.label.toLowerCase()} untuk ditampilkan.</p>}
        </>}
      </dialog>
  );
}
