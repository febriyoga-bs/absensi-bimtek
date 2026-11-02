import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { startGeoWatch } from '../lib/geo.js';
import { getDeviceId } from '../lib/device.js';
import { useNow, fmtFull, fmtHM, fmtRemaining, initials } from '../lib/time.js';
import CameraCapture from '../components/CameraCapture.jsx';
import Icon from '../components/Icon.jsx';
import BrandMark from '../components/BrandMark.jsx';

const ROLE = {
  peserta: { label: 'Peserta', icon: 'cap', placeholder: 'contoh: P-001', field: 'Kode / Nomor Peserta' },
  panitia: { label: 'Panitia', icon: 'idcard', placeholder: 'contoh: PN-01', field: 'Kode Panitia' },
};
const STEPS = ['Kode', 'Foto & Lokasi', 'Selesai'];

export default function Absen({ role }) {
  const R = ROLE[role];
  const [info, setInfo] = useState(null);
  const [step, setStep] = useState(0);
  const [code, setCode] = useState('');
  const [ch, setCh] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const now = useNow();

  useEffect(() => {
    document.body.dataset.role = role;
    api('/info').then(setInfo).catch((e) => setError(e.message));
    return () => { delete document.body.dataset.role; };
  }, [role]);

  const sess = info?.sessions?.[role];

  async function verify(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setCh(await api('/challenge', { method: 'POST', body: { code, role } }));
      setStep(1);
    } catch (err) {
      setError(err.status === 409 && err.data.at ? `${err.message} (${fmtFull(err.data.at)})` : err.message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep(0); setCh(null); setResult(null); setError(null); setCode('');
    api('/info').then(setInfo).catch(() => {});
  }

  return (
    <div className="absen">
      <header className="hero hero--absen">
        <div className="hero__deco" aria-hidden="true" />
        <nav className="topbar">
          <Link to="/" className="topbar__back"><Icon name="left" size={18} /> Beranda</Link>
          <span className="role-badge"><Icon name={R.icon} size={16} /> Absen {R.label}</span>
        </nav>
        <div className="hero__body hero__body--compact">
          <BrandMark size={48} className="hero__logo" />
          <h1>{info?.event_name || 'BIMTEK Revitalisasi SD'}</h1>
          {info?.event_dates && <p className="hero__sub">{info.event_dates}</p>}
        </div>
        <ol className="stepper">
          {STEPS.map((s, i) => (
            <li key={s} className={i < step ? 'done' : i === step ? 'on' : ''}>
              <span className="stepper__dot">{i < step ? <Icon name="check" size={14} stroke={3} /> : i + 1}</span>
              <span className="stepper__label">{s}</span>
            </li>
          ))}
        </ol>
      </header>

      <main className="sheet">
        {step === 0 && (
          <div className="card">
            {sess?.open ? (
              <div className="session-box">
                <span className="session-box__icon"><span className="live-dot" /></span>
                <span>
                  <small>Sesi sedang dibuka</small>
                  <b>{sess.open.name}</b>
                  <span className="muted small">
                    Absen {sess.open.type} · tutup {fmtHM(sess.open.ends_at)} WIB ({fmtRemaining(new Date(sess.open.ends_at) - now)} lagi)
                  </span>
                </span>
              </div>
            ) : info ? (
              <div className="session-box session-box--off">
                <span className="session-box__icon"><Icon name="clock" /></span>
                <span>
                  <small>Belum ada sesi {R.label.toLowerCase()} yang dibuka</small>
                  {sess?.next
                    ? <b>Berikutnya: {sess.next.name}, {fmtHM(sess.next.starts_at)} WIB</b>
                    : <b>Tunggu informasi dari panitia</b>}
                </span>
              </div>
            ) : null}

            <form onSubmit={verify} className="form">
              <label>
                {R.field}
                <span className="input-icon">
                  <Icon name="key" />
                  <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus required
                    placeholder={R.placeholder} autoComplete="off" autoCapitalize="characters" />
                </span>
              </label>
              {error && <div className="alert alert--err"><Icon name="alert" size={18} /><span>{error}</span></div>}
              <button className="btn btn--primary btn--lg" disabled={busy || !code.trim()}>
                {busy ? 'Memeriksa…' : <>Lanjut <Icon name="right" size={18} /></>}
              </button>
            </form>

            <ul className="checklist">
              <li><Icon name="crosshair" size={18} /><span>Aktifkan <b>GPS / Lokasi</b> lalu izinkan akses <b>Kamera</b> & <b>Lokasi</b> saat diminta.</span></li>
              <li><Icon name="pin" size={18} /><span>Absen hanya bisa di dalam area venue{info?.venues?.length ? `: ${info.venues.map((v) => v.name).join(', ')}` : ''}.</span></li>
              {info?.require_venue_code && <li><Icon name="monitor" size={18} /><span>Siapkan <b>kode venue 6 digit</b> dari layar panitia.</span></li>}
              <li><Icon name="shield" size={18} /><span>Aplikasi Fake GPS terdeteksi otomatis dan absensi akan ditolak atau diperiksa panitia.</span></li>
            </ul>
            <Link to="/riwayat" className="link-row"><Icon name="clock" size={16} />Sudah absen? Cek riwayat di perangkat ini</Link>
          </div>
        )}

        {step === 1 && ch && (
          <CaptureStep role={role} info={info} ch={ch}
            onDone={(r) => { setResult(r); setStep(2); }} onRestart={reset} />
        )}

        {step === 2 && result && <Done result={result} role={role} onClose={reset} />}
      </main>
    </div>
  );
}

function Signal({ accuracy }) {
  const bars = accuracy == null ? 0 : accuracy <= 10 ? 4 : accuracy <= 25 ? 3 : accuracy <= 60 ? 2 : 1;
  return (
    <span className="signal" aria-label={`Sinyal ${bars} dari 4`}>
      {[1, 2, 3, 4].map((i) => <i key={i} className={i <= bars ? 'on' : ''} style={{ height: 4 + i * 3 }} />)}
    </span>
  );
}

function CaptureStep({ role, info, ch, onDone, onRestart }) {
  const camRef = useRef(null);
  const watchRef = useRef(null);
  const checkedOnce = useRef(false);
  const [checking, setChecking] = useState(false);
  const [geo, setGeo] = useState({ samples: [], error: null });
  const [area, setArea] = useState(null);
  const [camLabel, setCamLabel] = useState('');
  const [photo, setPhoto] = useState(null);
  const [captureSamples, setCaptureSamples] = useState(null);
  const [venueCode, setVenueCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [startedAt] = useState(Date.now());
  const now = useNow();

  useEffect(() => {
    watchRef.current = startGeoWatch(setGeo);
    return () => watchRef.current?.stop();
  }, []);

  const last = geo.samples[geo.samples.length - 1];
  const elapsed = (now - startedAt) / 1000;
  const gpsReady = geo.samples.length >= 3 || (geo.samples.length >= 1 && elapsed > 10);

  // Cek area venue SEKALI saat GPS siap (pakai sampel paling akurat), selebihnya lewat tombol "Cek ulang".
  // Hemat request: dulu tiap 8 detik selama layar kamera terbuka.
  function checkArea() {
    const s = geo.samples.slice(-5).reduce((a, b) => (b.accuracy < a.accuracy ? b : a), geo.samples[geo.samples.length - 1]);
    if (!s) return;
    setChecking(true);
    api('/precheck', { method: 'POST', body: { token: ch.token, lat: s.lat, lng: s.lng, accuracy: s.accuracy } })
      .then(setArea).catch(() => {}).finally(() => setChecking(false));
  }
  useEffect(() => {
    if (!gpsReady || photo || checkedOnce.current) return;
    checkedOnce.current = true;
    checkArea();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsReady, photo]);

  function capture() {
    const lines = [
      `${info?.event_name || 'BIMTEK'} • ${ch.session.name}`,
      `${ch.person.name} (${role})`,
      `${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB${area?.inside ? ' • ' + area.venue : ''}`,
      `${last.lat.toFixed(6)}, ${last.lng.toFixed(6)} ±${Math.round(last.accuracy)} m • #${ch.nonce}`,
    ];
    const img = camRef.current?.capture(lines);
    if (!img) return setError('Kamera belum siap.');
    setCaptureSamples(geo.samples.slice(-15));
    setPhoto(img);
    setError(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api('/attendance', {
        method: 'POST',
        body: {
          token: ch.token, photo, samples: captureSamples, deviceId: getDeviceId(),
          venueCode: ch.require_venue_code ? venueCode : undefined,
          clientTime: new Date().toISOString(),
          meta: { cameraLabel: camLabel, webdriver: navigator.webdriver === true },
        },
      });
      watchRef.current?.stop();
      onDone(r);
    } catch (e) {
      setError(e.data?.reasons
        ? <><b>{e.message}</b><ul>{e.data.reasons.map((x) => <li key={x}>{x}</li>)}</ul></>
        : e.message);
      if (e.status === 401 || e.status === 409) setTimeout(onRestart, 3000);
    } finally {
      setBusy(false);
    }
  }

  const multiVenue = ch.venues.length > 1;
  const lowAcc = !!(last && area?.max_accuracy_m && last.accuracy > area.max_accuracy_m);

  return (
    <div className="card capture">
      <div className="person">
        <span className={`avatar avatar--${role}`}>{initials(ch.person.name)}</span>
        <span className="person__text">
          <b>{ch.person.name}</b>
          <small>{[ch.person.position, ch.person.institution].filter(Boolean).join(' · ') || ch.person.code}</small>
        </span>
        <span className="tag tag--type">{ch.session.type}</span>
      </div>

      <div className="viewfinder">
        {photo
          ? <img src={photo} alt="Foto absensi" className="preview" />
          : <CameraCapture ref={camRef} onReady={setCamLabel} />}
        {!photo && (
          <div className="viewfinder__hud" aria-hidden="true">
            <span className="hud-chip"><span className="rec-dot" /> LIVE</span>
            <span className="hud-chip">{now.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })}</span>
          </div>
        )}
        {!photo && <p className="viewfinder__hint">Posisikan wajah di dalam bingkai</p>}
      </div>

      <div className="status-grid">
        <div className={`status ${geo.error ? 'status--err' : !gpsReady ? 'status--wait' : lowAcc ? 'status--warn' : 'status--ok'}`}>
          <span className="status__icon"><Icon name="crosshair" /></span>
          <span className="status__text">
            <small>GPS</small>
            <b>{geo.error ? 'Tidak tersedia' : last ? `±${Math.round(last.accuracy)} m` : 'Mencari…'}</b>
          </span>
          {!geo.error && <Signal accuracy={last?.accuracy} />}
        </div>
        <div className={`status ${!area ? 'status--wait' : !area.inside ? 'status--err' : area.review ? 'status--warn' : 'status--ok'}`}>
          <span className="status__icon"><Icon name="pin" /></span>
          <span className="status__text">
            <small>Venue</small>
            <b>{!area ? 'Memeriksa…' : area.inside ? area.venue : area.state === 'unknown' ? 'Tidak pasti' : 'Di luar area'}</b>
          </span>
          {area?.distance_m != null && <span className="status__meta">{area.distance_m >= 1000 ? `${(area.distance_m / 1000).toFixed(1)} km` : `${area.distance_m} m`}</span>}
        </div>
      </div>
      {!photo && gpsReady && !geo.error && (
        <div className="recheck">
          <button type="button" className="link-btn" onClick={checkArea} disabled={checking}>
            <Icon name="refresh" size={14} />{checking ? 'Memeriksa lokasi…' : 'Cek ulang lokasi'}
          </button>
        </div>
      )}
      {geo.error && <div className="alert alert--err"><Icon name="alert" size={18} /><span>{geo.error}</span></div>}
      {area?.inside && area.review && (
        <div className="alert alert--warn"><Icon name="info" size={18} />
          <span><b>Akurasi GPS rendah.</b> Anda tetap bisa absen, tetapi absensi akan <b>diverifikasi manual oleh LO/panitia</b>.
            Agar langsung tercatat, aktifkan mode lokasi akurasi tinggi, dekati jendela/area terbuka, lalu tunggu beberapa detik.</span>
        </div>
      )}
      {area?.state === 'unknown' && (
        <div className="alert alert--err"><Icon name="alert" size={18} />
          <span>Lokasi belum bisa dipastikan (akurasi GPS terlalu buruk). Aktifkan GPS / mode lokasi akurasi tinggi lalu tunggu sebentar.</span>
        </div>
      )}
      {area && !area.inside && area.venue && (
        <div className="alert alert--warn"><Icon name="pin" size={18} />
          <span>Venue terdekat untuk Anda: <b>{area.venue}</b> (radius {area.radius_m} m).
            {multiVenue ? ` Venue Anda: ${ch.venues.map((v) => v.name).join(', ')}.` : ''} Mendekatlah ke lokasi lalu tunggu sebentar.</span>
        </div>
      )}

      {error && <div className="alert alert--err"><Icon name="alert" size={18} /><div>{error}</div></div>}

      {!photo ? (
        <button className="btn btn--primary btn--lg btn--shutter" onClick={capture} disabled={!gpsReady || !!geo.error}>
          <Icon name="camera" size={22} /> {gpsReady ? 'Ambil Foto' : 'Mengunci sinyal GPS…'}
        </button>
      ) : (
        <>
          {ch.require_venue_code && (
            <label className="form code-field">
              <span><Icon name="monitor" size={16} /> Kode venue dari layar panitia{area?.inside ? ` ${area.venue}` : ''}</span>
              <input inputMode="numeric" maxLength={6} value={venueCode} placeholder="000000" autoFocus
                onChange={(e) => setVenueCode(e.target.value.replace(/\D/g, ''))} className="input-code" />
            </label>
          )}
          <div className="row">
            <button className="btn" onClick={() => { setPhoto(null); setError(null); }} disabled={busy}>
              <Icon name="refresh" size={18} /> Ulangi
            </button>
            <button className="btn btn--primary" onClick={submit}
              disabled={busy || (ch.require_venue_code && venueCode.length !== 6)}>
              {busy ? 'Mengirim…' : <><Icon name="check" size={18} /> Kirim Absensi</>}
            </button>
          </div>
        </>
      )}
      <button className="link" onClick={onRestart}>Batal</button>
    </div>
  );
}

function Done({ result, role, onClose }) {
  const ok = result.status === 'valid';
  return (
    <div className="card done">
      <div className={`done__badge ${ok ? 'ok' : 'warn'}`}>
        <Icon name={ok ? 'check' : 'alert'} size={44} stroke={2.6} />
      </div>
      <h2>{ok ? 'Absensi berhasil!' : 'Absensi diterima'}</h2>
      <p className="muted">{ok ? 'Terima kasih, kehadiran Anda sudah tercatat.' : 'Data Anda perlu diverifikasi panitia.'}</p>

      <dl className="receipt">
        <div><dt>Nama</dt><dd>{result.name}</dd></div>
        <div><dt>Peran</dt><dd className="cap">{role}</dd></div>
        <div><dt>Sesi</dt><dd>{result.session} <span className="tag tag--type">{result.session_type}</span></dd></div>
        <div><dt>Venue</dt><dd>{result.venue} <span className="muted small">· {result.distance_m} m</span></dd></div>
        <div><dt>Waktu</dt><dd>{fmtFull(result.at)}</dd></div>
        <div><dt>Status</dt><dd><span className={`status-tag status-tag--${result.status}`}>{ok ? 'Valid' : 'Menunggu verifikasi'}</span></dd></div>
      </dl>

      {!ok && (
        <div className="alert alert--warn"><Icon name="info" size={18} />
          <span>Data lokasi atau perangkat Anda perlu dicek. Bila diminta, silakan lapor ke meja registrasi.</span>
        </div>
      )}
      <p className="muted small">Simpan bukti ini dengan screenshot bila diperlukan.</p>
      <div className="row">
        <Link to="/riwayat" className="btn"><Icon name="clock" size={18} />Riwayat</Link>
        <button className="btn btn--primary" onClick={onClose}>Selesai</button>
      </div>
    </div>
  );
}
