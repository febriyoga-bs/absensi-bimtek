import { personName } from '../../lib/personName.js';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { formatRoom } from '../../lib/room.js';
import { arrivalBadge } from './shared.js';
import WhatsAppLink from '../../components/WhatsAppLink.jsx';

const number = new Intl.NumberFormat('id-ID');

function attendanceLabel(person) {
  if (!person.registered) return 'Profil absensi belum tersedia';
  if (person.status === 'valid') return 'Sudah absen';
  if (person.status === 'review') return 'Sudah absen · perlu dicek';
  if (person.status === 'berhalangan') return 'Mundur/Berhalangan Hadir';
  return 'Belum absen';
}

function AssignmentSchools({ entry }) {
  const ids = entry.npsn?.split(';').map((value) => value.trim()) || [];
  const names = entry.npsn ? (entry.institution || '').split(';').map((value) => value.trim()) : [entry.institution];
  return <div className="muted small">
    {Array.from({ length: Math.max(ids.length, names.length) }, (_, i) => (
      <div key={i}>{[names[i], ids[i] && `NPSN ${ids[i]}`].filter(Boolean).join(' · ')}</div>
    ))}
    {entry.room && <div>Ruangan · {formatRoom(entry.room)}</div>}
  </div>;
}

export default function AttendanceDetailDialog({ details, onClose }) {
  const [detailResult, setDetailResult] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const dialog = useRef(null);

  useEffect(() => {
    if (!details) return;
    if (!dialog.current.open) dialog.current.showModal();
    let current = true;
    setDetailResult(null);
    setShowAll(false);
    api(details.path, { admin: true })
      .then((entries) => { if (current) setDetailResult({ entries }); })
      .catch(() => { if (current) setDetailResult({ error: true }); });
    return () => { current = false; };
  }, [details]);

  const detailEntries = detailResult?.entries ?? details?.entries;
  const checkedIn = details?.filterByCheckIn ? detailEntries?.filter((entry) =>
    entry.people?.some((person) => person.status === 'valid' || person.status === 'review')) : null;
  const shownEntries = details?.filterByCheckIn && !showAll ? checkedIn : detailEntries;
  return (
      <dialog ref={dialog} className="assignment-dialog" aria-labelledby="assignment-detail-title"
        onClose={onClose}>
        {details && <>
          <header>
            <div>
              <h3 id="assignment-detail-title">Daftar {details.label}</h3>
              <p className="muted small">{details.subtitle}</p>
              {shownEntries && <span className="assignment-detail-count">{number.format(shownEntries.length)} hasil</span>}
            </div>
            <form method="dialog"><button className="btn btn--sm" autoFocus><Icon name="x" size={16} />Tutup</button></form>
          </header>
          {!detailResult && <p className="muted small" role="status">Memuat status absensi…</p>}
          {detailResult?.error && <p className="alert alert--warn" role="status">Status absensi gagal dimuat. Tutup dan buka kembali daftar untuk mencoba lagi.</p>}
          {details.filterByCheckIn && detailEntries && <div className="assignment-tabs attendance-detail-tabs" role="group" aria-label="Tampilan daftar absensi">
            <button type="button" aria-pressed={!showAll} className={!showAll ? 'on' : ''} onClick={() => setShowAll(false)}>
              Sudah absen <span>{number.format(checkedIn.length)}</span>
            </button>
            <button type="button" aria-pressed={showAll} className={showAll ? 'on' : ''} onClick={() => setShowAll(true)}>
              Semua peserta <span>{number.format(detailEntries.length)}</span>
            </button>
          </div>}
          {detailResult?.entries?.length > 0 && <p className="muted small">
            {details.checkInDays?.length ? 'Absensi per hari mengikuti tanggal sesi resmi (WIB).'
              : details.sessionDay ? `Status resmi ${details.sessionDay} di venue ini.` : 'Absensi dari sesi resmi di venue ini.'}
          </p>}
          {shownEntries?.length > 0 && <ol>
            {shownEntries.map((entry, index) => (
              <li key={entry.npsn || index}>
                <b>{personName(entry.name)}</b>
                <AssignmentSchools entry={entry} />
                {entry.people?.map((person) => {
                  const [arrival, arrivalStyle] = arrivalBadge(person.arrival_status);
                  return <div key={`${person.position || ''}:${personName(person.name)}`} className="assignment-person">
                    {person.position && <span className="small"><b>{person.position}</b> · {personName(person.name)}</span>}
                    <WhatsAppLink name={personName(person.name)} phone={person.phone} />
                    {Object.hasOwn(person, 'arrival_status') && <span className={`tag ${arrivalStyle}`}>Venue · {arrival}</span>}
                    {details.checkInDays?.length ? <div className="assignment-person-days">
                      {details.checkInDays.map((day) => {
                        const checkedIn = person.check_in_dates?.includes(day.date);
                        return <div key={day.date}>
                          <div className="muted small">{day.label} · {day.shortDate}</div>
                          <span className={`tag ${checkedIn ? 'tag--open' : 'tag--off'}`}>
                            {checkedIn ? 'Sudah absen' : person.registered ? 'Belum absen' : 'Profil belum tersedia'}
                          </span>
                        </div>;
                      })}
                    </div> : <span className={`tag ${person.status === 'valid' ? 'tag--open' : person.status === 'review' ? 'tag--venue' : 'tag--off'}`}>
                      {attendanceLabel(person)}
                    </span>}
                  </div>;
                })}
                {entry.people?.length === 0 && <small className="muted">Nama peserta belum tersedia.</small>}
              </li>
            ))}
          </ol>}
          {shownEntries?.length === 0 && <p className="muted">{details.filterByCheckIn && !showAll
            ? 'Belum ada yang absen pada cakupan ini.'
            : `Tidak ada ${details.label.toLowerCase()} untuk ditampilkan.`}</p>}
        </>}
      </dialog>
  );
}
