import { useState } from 'react';
import { Navigate, useOutletContext } from 'react-router-dom';
import { api } from '../../api.js';
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
  if (!user) return null;
  if (!lo) return <Navigate to="/admin" replace />;

  async function start() {
    setError(null);
    setBusy(true);
    try {
      setChallenge(await api('/lo/challenge', { method: 'POST', admin: true }));
    } catch (e) {
      setError(e.data?.at ? `${e.message} (${fmtFull(e.data.at)})` : e.message);
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
        {result ? <Done result={result} role="LO" onClose={() => setResult(null)} />
          : challenge ? <CaptureStep role="panitia" selfLo ch={challenge}
            onDone={(receipt) => { setChallenge(null); setResult(receipt); }}
            onRestart={() => setChallenge(null)} />
            : <div className="card form">
              <div className="person">
                <Icon name="idcard" size={24} />
                <span className="person__text"><b>{user.name}</b><small>{user.venue?.name}</small></span>
              </div>
              {error && <div className="alert alert--err" role="alert">{error}</div>}
              <button type="button" className="btn btn--primary" disabled={busy} onClick={start}>
                {busy ? <Spinner size={18} /> : <Icon name="camera" size={18} />} Mulai Absen
              </button>
            </div>}
      </div>
    </>
  );
}
