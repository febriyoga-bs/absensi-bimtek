import { useEffect, useState } from 'react';
import { Navigate, useOutletContext } from 'react-router-dom';
import { api, adminToken } from '../../api.js';
import { eventPath } from '../../event.js';
import { personName } from '../../lib/personName.js';
import { sessionTitle } from './shared.js';
import { fmtFull } from '../../lib/time.js';
import { CaptureStep, Done } from '../Absen.jsx';
import Icon from '../../components/Icon.jsx';
import { Spinner } from '../../components/Skeleton.jsx';

export default function LoSelfAttendance() {
  const { user, lo } = useOutletContext();
  const [challenge, setChallenge] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!lo || !user) return;
    let live = true;
    api('/lo/attendance', { admin: true }).then((data) => {
      if (live) { setHistory(data); setHistoryError(''); }
    }).catch((e) => { if (live) setHistoryError(e.message); });
    return () => { live = false; };
  }, [lo, user, revision]);
  if (!user) return null;
  if (!lo) return <Navigate to="/admin" replace />;

  async function start() {
    setError(null);
    setBusy(true);
    try {
      setChallenge(await api('/lo/challenge', { method: 'POST', admin: true }));
    } catch (e) {
      setError(e.data?.at ? `${e.message} (${fmtFull(e.data.at)})` : e.message);
      if (e.status === 409) setRevision((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Absen Saya</h2>
          <p className="muted">Kirim absensi Anda menggunakan foto dan lokasi di venue penugasan.</p>
        </div>
      </div>
      <div className="lo-self-attendance">
        {challenge?.session?.is_test && <p className="alert alert--warn" role="status">Mode uji coba aktif.</p>}
        {result ? <Done result={result} role="LO" onClose={() => setResult(null)} />
          : challenge ? <CaptureStep role="panitia" selfLo ch={challenge}
            onDone={(receipt) => { setChallenge(null); setResult(receipt); setRevision((n) => n + 1); }}
            onRestart={() => setChallenge(null)} />
            : <div className="card form">
              <div className="person">
                <Icon name="idcard" size={24} />
                <span className="person__text"><b>{personName(user.name)}</b><small>{user.venue?.name}</small></span>
              </div>
              {error && <div className="alert alert--err" role="alert">{error}</div>}
              {!history && !historyError && <p role="status"><Spinner size={18} /> Memuat hasil absensi…</p>}
              {history?.recorded ? <p className="alert" role="status"><Icon name="check" size={18} /> Absensi Anda pada sesi ini sudah tercatat.</p> : <button type="button" className="btn btn--primary" disabled={busy || !history} onClick={start}>
                {busy ? <Spinner size={18} /> : <Icon name="camera" size={18} />} {history?.retry ? 'Absen Ulang' : 'Mulai Absen'}
              </button>}
            </div>}
        {historyError && <p className="alert alert--err" role="alert">{historyError} <button className="btn btn--sm" onClick={() => setRevision((n) => n + 1)}>Coba lagi</button></p>}
        {!challenge && !!history?.records.length && <section className="lo-self-history" aria-label="Hasil absensi saya">
          <h3>Hasil Absensi Saya</h3>
          {history.records.map((record) => <article className="card form" key={record.id}>
            <div><b>{sessionTitle({ name: record.session, type: record.session_type })}</b>
              {record.is_test && <p className="alert alert--warn">Uji coba</p>}</div>
            {record.has_photo && <img className="preview lo-self-photo" loading="lazy"
              src={`/api${eventPath(`/lo/attendance/${record.id}/photo?t=${encodeURIComponent(adminToken.get() || '')}`)}`}
              alt={`Foto absensi ${personName(record.name)} pada ${record.session}`} />}
            <dl className="receipt">
              <div><dt>Nama</dt><dd>{personName(record.name)}</dd></div>
              <div><dt>Venue</dt><dd>{record.venue}</dd></div>
              <div><dt>Waktu</dt><dd>{fmtFull(record.at)}</dd></div>
              <div><dt>Status</dt><dd><span className={`status-tag status-tag--${record.status}`}>{({ valid: 'Valid', review: 'Menunggu verifikasi', ditolak: 'Ditolak', berhalangan: 'Berhalangan' })[record.status] || record.status}</span></dd></div>
            </dl>
            {record.status === 'ditolak' && <>
              <button type="button" className="btn btn--primary" disabled={busy || record.session_id !== history.current_session_id} onClick={start}>
                {busy ? <Spinner size={18} /> : <Icon name="refresh" size={18} />} Absen Ulang
              </button>
              {record.session_id !== history.current_session_id && <p className="muted small">Absen ulang tersedia saat sesi ini dibuka.</p>}
            </>}
          </article>)}
        </section>}
      </div>
    </>
  );
}
