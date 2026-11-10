import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { startGeoWatch } from '../lib/geo.js';
import { getDeviceId } from '../lib/device.js';
import { formatRoom } from '../lib/room.js';
import { useNow, fmtFull, fmtHM, fmtRemaining, initials } from '../lib/time.js';
import CameraCapture from '../components/CameraCapture.jsx';
import Icon from '../components/Icon.jsx';
import BrandMark from '../components/BrandMark.jsx';
import { Skel, Spinner } from '../components/Skeleton.jsx';

const ROLE = {
  peserta: { label: 'Peserta', icon: 'cap', placeholder: 'contoh: B-20100001 / P-20100001', field: 'Kode / Nomor Peserta' },
  panitia: { label: 'Panitia', icon: 'idcard', placeholder: 'contoh: PN-01', field: 'Kode Panitia' },
};
const STEPS = ['Kode', 'Foto & Lokasi', 'Selesai'];

export default function Absen({ role }) {
  const R = ROLE[role];
  const [info, setInfo] = useState(null);
  const [step, setStep] = useState(0);
  const [code, setCode] = useState('');
  // peserta: cari lewat NPSN lalu pilih jabatan; panitia: ketik kode
  const [mode, setMode] = useState(role === 'peserta' ? 'npsn' : 'kode');
  const [npsn, setNpsn] = useState('');
  const [found, setFound] = useState(null);
  const [picking, setPicking] = useState(null);
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

  async function findNpsn(e) {
    e.preventDefault();
    setError(null); setFound(null); setBusy(true);
    try { setFound(await api('/npsn', { method: 'POST', body: { npsn } })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function verify(e, pick) {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setCh(await api('/challenge', { method: 'POST', body: { code: pick || code, role } }));
      setStep(1);
    } catch (err) {
      setError(err.status === 409 && err.data.at ? `${err.message} (${fmtFull(err.data.at)})` : err.message);
    } finally {
      setBusy(false);
      setPicking(null);
    }
  }

  function reset() {
    setStep(0); setCh(null); setResult(null); setError(null); setCode(''); setNpsn(''); setFound(null);
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
            ) : !info ? (
              <div className="session-box session-box--skel"><Skel w={44} h={44} r={12} /><span style={{ flex: 1, display: 'grid', gap: 8 }}><Skel w="40%" h={12} /><Skel w="75%" h={16} /></span></div>
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

            {mode === 'npsn' && (
              <div className="form">
                <form onSubmit={findNpsn} className="form">
                  <label>
                    NPSN sekolah
                    <span className="input-icon">
                      <Icon name="school" />
                      <input value={npsn} inputMode="numeric" maxLength={8} autoFocus required placeholder="8 digit, contoh: 20311972"
                        onChange={(e) => { setNpsn(e.target.value.replace(/\D/g, '')); setFound(null); }} />
                    </span>
                    <small className="muted" style={{ fontWeight: 400 }}>Pengawas: isi NPSN salah satu sekolah binaan.</small>
                  </label>
                  {!found && (
                    <button className="btn btn--primary btn--lg" disabled={busy || npsn.length !== 8}>
                      {busy ? <><Spinner /> Mencari…</> : <>Cari <Icon name="right" size={18} /></>}
                    </button>
                  )}
                </form>
                {found && (
                  <div className="npsn-pick">
                    <div className="npsn-pick__school"><Icon name="school" size={18} /><span><b>{found.school || 'Sekolah'}</b><small>NPSN {found.npsn}</small></span></div>
                    <p className="muted small" style={{ margin: 0 }}>Anda hadir sebagai:</p>
                    {found.options.map((o) => (o.people.length ? o.people.map((p) => (
                      <button key={p.code} type="button" className="npsn-opt" disabled={busy} onClick={(e) => { setPicking(p.code); verify(e, p.code); }}>
                        <span className="npsn-opt__role">{p.position || o.label}</span>
                        <b>{p.name}</b>
                        {picking === p.code ? <Spinner size={18} /> : <Icon name="right" size={18} />}
                      </button>
                    )) : (
                      <div key={o.key} className="npsn-opt npsn-opt--off">
                        <span className="npsn-opt__role">{o.label}</span>
                        <span className="muted small">Tidak terdaftar sebagai peserta</span>
                      </div>
                    )))}
                    <button type="button" className="link-btn" onClick={() => { setFound(null); setNpsn(''); setError(null); }}>
                      <Icon name="left" size={14} />Ganti NPSN
                    </button>
                  </div>
                )}
                {error && <div className="alert alert--err"><Icon name="alert" size={18} /><span>{error}</span></div>}
                <button type="button" className="link-btn" onClick={() => { setMode('kode'); setError(null); }}>
                  <Icon name="key" size={14} />Pakai kode peserta
                </button>
              </div>
            )}

            {mode === 'kode' && (
            <form onSubmit={verify} className="form">
              <label>
                {R.field}
                <span className="input-icon">
                  <Icon name="key" />
                  <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus required
                    placeholder={R.placeholder} autoComplete="off" autoCapitalize="characters" />
                </span>
                {role === 'peserta' && (
                  <small className="muted" style={{ fontWeight: 400 }}>
                    Bendahara: <b>B-</b>NPSN sekolah · Pengawas: <b>P-</b>NPSN salah satu sekolah binaan
                  </small>
                )}
              </label>
              {error &&<div className="alert alert--err"><Icon name="alert" size={18} /><span>{error}</span></div>}
              <button className="btn btn--primary btn--lg" disabled={busy || !code.trim()}>
                {busy ? <><Spinner /> Memeriksa…</> : <>Lanjut <Icon name="right" size={18} /></>}
              </button>
              {role === 'peserta' && (
                <button type="button" className="link-btn" onClick={() => { setMode('npsn'); setError(null); }}>
                  <Icon name="school" size={14} />Cari lewat NPSN sekolah
                </button>
              )}
            </form>
            )}

            <ul className="checklist">
              <li><Icon name="crosshair" size={18} /><span>Aktifkan <b>GPS / Lokasi</b> lalu izinkan akses <b>Kamera</b> & <b>Lokasi</b> saat diminta.</span></li>
              <li><Icon name="pin" size={18} /><span>Absen hanya bisa di dalam area venue{info?.venues?.length ? `: ${info.venues.map((v) => v.name).join(', ')}` : ''}.</span></li>
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

export function CaptureStep({ role, info, ch, onDone, onRestart, selfLo = false }) {
  const camRef = useRef(null);
  const watchRef = useRef(null);
  const checkedOnce = useRef(false);
  const [checking, setChecking] = useState(false);
  const [geo, setGeo] = useState({ samples: [], error: null });
  const [area, setArea] = useState(null);
  const [camLabel, setCamLabel] = useState('');
  const [photo, setPhoto] = useState(null);
  const [captureSamples, setCaptureSamples] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [startedAt] = useState(Date.now());
  const now = useNow();

  // tampilkan bingkai kamera + tombol tanpa perlu scroll
  useEffect(() => { document.querySelector('.capture')?.scrollIntoView({ block: 'start' }); }, []);

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
    api(selfLo ? '/lo/precheck' : '/precheck', { method: 'POST', admin: selfLo, body: { token: ch.token, lat: s.lat, lng: s.lng, accuracy: s.accuracy } })
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
      const r = await api(selfLo ? '/lo/attendance' : '/attendance', {
        method: 'POST',
        admin: selfLo,
        body: {
          token: ch.token, photo, samples: captureSamples, deviceId: getDeviceId(),
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
      if ([401, 409, 410].includes(e.status)) setTimeout(onRestart, 3000);
      // pesan error ada di bawah bingkai kamera → gulir agar terlihat
      setTimeout(() => document.querySelector('.capture .alert--err')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
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
          {ch.person.ruangan && <small>Ruangan: <b>{formatRoom(ch.person.ruangan)}</b></small>}
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

        {/* Tombol ada DI DALAM bingkai kamera agar tidak perlu scroll */}
        <div className={`viewfinder__actions ${photo ? 'viewfinder__actions--below' : ''}`}>
          {!photo ? (
            <>
              <span className={`vf-note ${geo.error || (area && !area.inside) ? 'vf-note--err' : !gpsReady || area?.review ? 'vf-note--warn' : ''}`}>
                {geo.error ? 'GPS tidak tersedia'
                  : !gpsReady ? 'Mengunci sinyal GPS…'
                    : !area ? 'Memeriksa lokasi…'
                      : !area.inside ? `Di luar area venue${area.distance_m != null ? ` (${area.distance_m >= 1000 ? `${(area.distance_m / 1000).toFixed(1)} km` : `${area.distance_m} m`})` : ''}`
                        : area.review ? `${area.venue} · akurasi rendah` : `Posisikan wajah di bingkai · ${area.venue}`}
              </span>
              <button type="button" className="shutter" onClick={capture} disabled={!gpsReady || !!geo.error}
                aria-label="Ambil foto"><Icon name="camera" size={30} /></button>
            </>
          ) : (
            <div className="vf-buttons">
              <button className="btn" onClick={() => { setPhoto(null); setError(null); }} disabled={busy}>
                <Icon name="refresh" size={18} /> Ulangi
              </button>
              <button className="btn btn--primary" onClick={submit} disabled={busy}>
                {busy ? <><Spinner /> Mengirim…</> : <><Icon name="check" size={18} /> Kirim Absensi</>}
              </button>
            </div>
          )}
        </div>
      </div>
      {error && <div className="alert alert--err"><Icon name="alert" size={18} /><div>{error}</div></div>}

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
            {checking ? <><Spinner size={13} /> Memeriksa lokasi…</> : <><Icon name="refresh" size={14} />Cek ulang lokasi</>}
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

      <button className="link" onClick={onRestart}>Batal</button>
    </div>
  );
}

export function Done({ result, role, onClose }) {
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
