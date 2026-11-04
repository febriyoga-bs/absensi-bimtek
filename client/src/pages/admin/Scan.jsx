import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import jsQR from 'jsqr';
import { api } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { fmtDT } from './shared.js';
import { Skel, Spinner } from '../../components/Skeleton.jsx';

/** Bunyi singkat: nada tinggi = berhasil, nada rendah = gagal */
function beep(ok) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = ok ? 1150 : 300; o.type = ok ? 'sine' : 'square';
    g.gain.value = 0.12; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + (ok ? 0.15 : 0.35));
    o.onended = () => ctx.close();
  } catch { /* abaikan */ }
  navigator.vibrate?.(ok ? 80 : [60, 60, 60]);
}

const KIND = {
  ok: { cls: 'ok', icon: 'check', title: 'Absen tercatat' },
  dup: { cls: 'warn', icon: 'clock', title: 'Sudah absen' },
  err: { cls: 'err', icon: 'x', title: 'Gagal' },
};

export default function Scan() {
  const { lo, user } = useOutletContext();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const busyRef = useRef(false);
  const recentRef = useRef(new Map()); // isi QR → waktu terakhir dipindai (hindari dobel)
  const [camErr, setCamErr] = useState(null);
  const [running, setRunning] = useState(true);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [venues, setVenues] = useState([]);
  const [venueId, setVenueId] = useState('');
  const [manual, setManual] = useState('');
  const [tab, setTab] = useState('qr'); // 'qr' | 'sekolah'
  const [schoolQ, setSchoolQ] = useState('');
  const [schoolOpts, setSchoolOpts] = useState([]);
  const [searching, setSearching] = useState(false);
  const [schoolLoading, setSchoolLoading] = useState(false);
  const [openList, setOpenList] = useState(false);
  const [school, setSchool] = useState(null);
  const [schoolErr, setSchoolErr] = useState(null);
  const [pending, setPending] = useState(null); // kode yang sedang diabsenkan
  const venueRef = useRef('');
  venueRef.current = venueId;

  useEffect(() => { if (!lo) api('/admin/venues', { admin: true }).then(setVenues).catch(() => {}); }, [lo]);

  async function submit(body) {
    busyRef.current = true;
    let r;
    try {
      const d = await api('/admin/scan', { method: 'POST', admin: true, body: { ...body, venue_id: venueRef.current || undefined } });
      r = { kind: 'ok', person: d.person, session: d.session, at: d.at };
    } catch (e) {
      const d = e.data || {};
      r = { kind: e.status === 409 ? 'dup' : 'err', msg: e.message, person: d.person, session: d.session, at: d.at };
    }
    r.id = Date.now();
    beep(r.kind === 'ok');
    setResult(r);
    setHistory((h) => [r, ...h].slice(0, 30));
    return r;
    // jeda sebentar agar LO sempat membaca hasilnya
    setTimeout(() => { busyRef.current = false; }, 1200);
  }

  // Autocomplete sekolah (nama sekolah / NPSN / nama peserta)
  useEffect(() => {
    if (tab !== 'sekolah' || schoolQ.trim().length < 2) { setSchoolOpts([]); return undefined; }
    setSearching(true);
    const t = setTimeout(() => {
      api(`/admin/schools?q=${encodeURIComponent(schoolQ.trim())}`, { admin: true }).then(setSchoolOpts).catch(() => setSchoolOpts([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [schoolQ, tab]);

  async function openSchool(npsn) {
    setOpenList(false); setSchoolErr(null); setSchoolLoading(true);
    try { setSchool(await api(`/admin/school/${npsn}`, { admin: true })); }
    catch (e) { setSchoolErr(e.message); setSchool(null); }
    finally { setSchoolLoading(false); }
  }

  async function absenkan(p) {
    setPending(p.code);
    await submit({ code: p.code });
    busyRef.current = false;
    await openSchool(school.npsn);
    setPending(null);
  }

  // Kamera belakang + pemindaian QR (± 6 kali per detik); mati saat tab "Cari sekolah"
  useEffect(() => {
    if (!running || tab !== 'qr') return undefined;
    let stream; let timer; let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
        });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setCamErr(null);
        const tick = () => {
          if (stopped) return;
          if (!busyRef.current && v.readyState >= 2 && v.videoWidth) {
            const scale = Math.min(1, 640 / v.videoWidth);
            const w = Math.round(v.videoWidth * scale); const h = Math.round(v.videoHeight * scale);
            const c = canvasRef.current; c.width = w; c.height = h;
            const g = c.getContext('2d', { willReadFrequently: true });
            g.drawImage(v, 0, 0, w, h);
            const code = jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
            if (code?.data) {
              const now = Date.now();
              const last = recentRef.current.get(code.data) || 0;
              if (now - last > 6000) { recentRef.current.set(code.data, now); submit({ qr: code.data }); }
            }
          }
          timer = setTimeout(tick, 160);
        };
        tick();
      } catch (e) {
        setCamErr(e.name === 'NotAllowedError'
          ? 'Izin kamera ditolak. Izinkan kamera di pengaturan browser lalu muat ulang halaman.'
          : 'Kamera tidak bisa dibuka. Gunakan Chrome/Safari terbaru lewat HTTPS, atau ketik kode secara manual.');
      }
    })();
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [running, tab]);

  const K = result && KIND[result.kind];

  return (
    <>
      <div className="page-head">
        <div><h2>Absenkan Peserta</h2>
          <p className="muted">
            Scan QR peserta atau cari sekolahnya. Absen langsung tercatat di sesi yang sedang dibuka
            {lo && user?.venue ? <> untuk venue <b>{user.venue.name}</b></> : ''}.
          </p></div>
        {tab === 'qr' && (
          <button className="btn" onClick={() => setRunning((x) => !x)}>
            <Icon name={running ? 'x' : 'camera'} size={18} />{running ? 'Matikan kamera' : 'Nyalakan kamera'}
          </button>
        )}
      </div>
      <div className="tabs">
        <button className={tab === 'qr' ? 'on' : ''} onClick={() => setTab('qr')}><Icon name="qr" size={16} /> Scan QR</button>
        <button className={tab === 'sekolah' ? 'on' : ''} onClick={() => setTab('sekolah')}><Icon name="school" size={16} /> Cari sekolah</button>
      </div>

      <div className="scan">
        {tab === 'sekolah' && (
          <div className="scan__cam card form">
            <label className="ac">
              <span>Sekolah</span>
              <span className="input-icon">
                <Icon name="school" />
                <input value={schoolQ} autoFocus placeholder="Ketik nama sekolah, NPSN, atau nama peserta"
                  onChange={(e) => { setSchoolQ(e.target.value); setOpenList(true); }}
                  onFocus={() => setOpenList(true)} onBlur={() => setTimeout(() => setOpenList(false), 150)} />
              </span>
              {openList && schoolQ.trim().length >= 2 && (
                <ul className="ac__list" role="listbox">
                  {schoolOpts.map((o) => (
                    <li key={o.npsn}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setSchoolQ(o.school); openSchool(o.npsn); }}>
                      <b>{o.school}</b><small>NPSN {o.npsn}{o.kab_kota ? ` · ${o.kab_kota.split('; ')[0]}` : ''}</small>
                    </button></li>
                  ))}
                  {searching && !schoolOpts.length && <li className="ac__empty"><Spinner size={14} /> Mencari…</li>}
                  {!searching && !schoolOpts.length && <li className="ac__empty">Tidak ada sekolah yang cocok{lo ? ' di venue ini' : ''}.</li>}
                </ul>
              )}
            </label>
            {schoolErr && <div className="alert alert--err"><Icon name="alert" size={18} /><span>{schoolErr}</span></div>}
            {schoolLoading && !school && (
              <div className="school"><Skel h={56} r={10} /><Skel h={64} r={10} /><Skel h={64} r={10} /><Skel h={64} r={10} /></div>
            )}
            {school && (
              <div className="school" style={schoolLoading && !pending ? { opacity: 0.55 } : undefined}>
                <div className="npsn-pick__school"><Icon name="school" size={18} />
                  <span><b>{school.school}</b><small>NPSN {school.npsn}{school.kab_kota ? ` · ${school.kab_kota.split('; ')[0]}` : ''}</small></span></div>
                {!school.session && <div className="alert alert--warn"><Icon name="clock" size={18} /><span>Belum ada sesi peserta yang dibuka saat ini.</span></div>}
                {school.session && <p className="muted small" style={{ margin: 0 }}>Sesi: <b>{school.session.type || school.session.name}</b></p>}
                <ul className="school__people">
                  {school.people.map((p) => (
                    <li key={p.code}>
                      <span className="school__who">
                        <small>{p.position || 'Peserta'}</small>
                        <b>{p.name}</b>
                        <small className="muted">{p.code}{p.ruangan ? ` · ${p.ruangan}` : ''}{p.other_venue ? ` · venue: ${p.venue_name}` : ''}</small>
                      </span>
                      {p.attended ? (
                        <span className="st st--valid" title={p.attended.method}>✓ {fmtDT(p.attended.at).split(', ').pop()}</span>
                      ) : p.other_venue ? (
                        <span className="muted small">Venue lain</span>
                      ) : (
                        <button className="btn btn--sm btn--primary" disabled={!school.session || pending === p.code} onClick={() => absenkan(p)}>
                          {pending === p.code ? <><Spinner size={13} /> Menyimpan…</> : 'Absenkan'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === 'qr' && (
        <div className="scan__cam card">
          {!lo && (
            <label className="form" style={{ marginBottom: 12 }}>
              <span className="small">Venue pencatatan</span>
              <select value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                <option value="">Sesuai venue peserta</option>
                {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
          )}
          <div className="scan__view">
            {running && !camErr && <video ref={videoRef} playsInline muted />}
            {running && !camErr && <span className="scan__frame" aria-hidden="true" />}
            {(!running || camErr) && (
              <div className="scan__off"><Icon name="camera" size={34} /><span>{camErr || 'Kamera dimatikan'}</span></div>
            )}
          </div>
          <canvas ref={canvasRef} hidden />
          <form className="row scan__manual" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { submit({ code: manual.trim() }); setManual(''); } }}>
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Ketik kode manual (mis. B-20100001)" />
            <button className="btn btn--primary" disabled={!manual.trim()}>Catat</button>
          </form>
        </div>
        )}

        <div className="scan__side">
          {result ? (
            <div key={result.id} className={`card scan__result scan__result--${K.cls}`}>
              <span className="scan__badge"><Icon name={K.icon} size={26} /></span>
              <div>
                <b className="scan__title">{K.title}</b>
                {result.person && (
                  <>
                    <div className="scan__name">{result.person.name}</div>
                    <div className="muted small">{[result.person.position, result.person.code].filter(Boolean).join(' · ')}</div>
                    {result.person.institution && <div className="muted small">{result.person.institution}</div>}
                    {result.person.ruangan && <div className="small">Ruangan: <b>{result.person.ruangan}</b></div>}
                  </>
                )}
                {result.session && <div className="small">{result.session.type || result.session.name}</div>}
                {result.at && <div className="small">{result.kind === 'dup' ? 'Tercatat sebelumnya: ' : ''}{fmtDT(result.at)} WIB</div>}
                {result.kind !== 'ok' && <div className="small scan__msg">{result.msg}</div>}
              </div>
            </div>
          ) : (
            <div className="card scan__result"><span className="muted">Belum ada QR yang dipindai.</span></div>
          )}

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Riwayat scan perangkat ini</h3>
            {!history.length && <p className="muted small">Kosong.</p>}
            <ul className="scan__hist">
              {history.map((h) => (
                <li key={h.id} className={`scan__hist--${KIND[h.kind].cls}`}>
                  <Icon name={KIND[h.kind].icon} size={15} />
                  <span><b>{h.person?.name || h.msg}</b>{h.person && h.kind !== 'ok' && <small> — {h.msg}</small>}</span>
                  <small className="muted">{new Date(h.id).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</small>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
