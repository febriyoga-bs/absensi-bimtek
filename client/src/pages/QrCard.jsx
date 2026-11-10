import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../api.js';
import { formatRoom } from '../lib/room.js';
import Icon from '../components/Icon.jsx';
import BrandMark from '../components/BrandMark.jsx';
import { Skel } from '../components/Skeleton.jsx';

/**
 * Kartu QR pribadi (link dikirim lewat WhatsApp). Peserta cukup menunjukkan
 * QR ini ke LO/panitia, yang memindainya dari menu "Scan QR".
 */
export default function QrCard() {
  const { token } = useParams();
  const [p, setP] = useState(null);
  const [img, setImg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api(`/qr/${token}`).then(setP).catch((e) => setError(e.message));
    QRCode.toDataURL(`${window.location.origin}/qr/${token}`, {
      width: 720, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0b1f3a', light: '#ffffff' },
    }).then(setImg);
  }, [token]);

  // Simpan sebagai gambar (QR + nama) agar bisa ditunjukkan walau tanpa internet
  async function save() {
    const qr = new Image();
    qr.src = img;
    await qr.decode();
    const W = 720, pad = 40, c = document.createElement('canvas');
    c.width = W; c.height = W + 220;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(qr, 0, 0, W, W);
    g.fillStyle = '#0b1f3a'; g.textAlign = 'center';
    g.font = 'bold 34px sans-serif'; g.fillText(p.name.slice(0, 40), W / 2, W + pad);
    g.font = '26px sans-serif'; g.fillStyle = '#5d6b82';
    g.fillText([p.position, p.code].filter(Boolean).join(' · ').slice(0, 50), W / 2, W + pad + 44);
    if (p.ruangan || p.venue) g.fillText([p.venue, formatRoom(p.ruangan)].filter(Boolean).join(' – ').slice(0, 55), W / 2, W + pad + 84);
    g.font = '22px sans-serif'; g.fillText(p.event_name || 'Absensi', W / 2, W + pad + 130);
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `QR-absen-${p.code}.png`;
    a.click();
  }

  return (
    <div className="absen">
      <header className="hero hero--absen">
        <div className="hero__deco" aria-hidden="true" />
        <nav className="topbar">
          <Link to="/" className="topbar__back"><Icon name="left" size={18} /> Beranda</Link>
        </nav>
        <div className="hero__body hero__body--compact">
          <BrandMark size={48} className="hero__logo" />
          <h1>QR Absensi</h1>
          <p className="hero__sub">{p?.event_name || 'Tunjukkan QR ini ke LO / panitia'}</p>
        </div>
      </header>

      <main className="sheet">
        <div className="card qr-card">
          {error && <div className="alert alert--err"><Icon name="alert" size={18} /><span>{error}</span></div>}
          {!error && (
            <>
              <div className="qr-card__img">{img ? <img src={img} alt="QR absensi" /> : <Skel w="100%" h="100%" r={10} />}</div>
              {p ? (
                <div className="qr-card__info">
                  <b>{p.name}</b>
                  <span>{[p.position, p.code].filter(Boolean).join(' · ')}</span>
                  {p.institution && <span className="muted small">{p.institution}</span>}
                  {(p.venue || p.ruangan) && (
                    <span className="tag tag--venue"><Icon name="pin" size={13} /> {[p.venue, formatRoom(p.ruangan)].filter(Boolean).join(' – ')}</span>
                  )}
                </div>
              ) : <div className="qr-card__info" style={{ width: '70%' }}><Skel w="80%" h={20} /><Skel w="55%" /><Skel w="65%" h={12} /></div>}
              <ul className="checklist">
                <li><Icon name="qr" size={18} /><span>Saat absen, <b>tunjukkan QR ini</b> ke LO / panitia untuk dipindai.</span></li>
                <li><Icon name="info" size={18} /><span>QR ini <b>khusus untuk Anda</b>. Jangan dibagikan ke orang lain.</span></li>
                <li><Icon name="download" size={18} /><span>Simpan gambarnya agar tetap bisa ditunjukkan meski sinyal lemah.</span></li>
              </ul>
              <button className="btn btn--primary btn--lg" onClick={save} disabled={!img || !p}>
                <Icon name="download" size={18} /> Simpan QR ke galeri
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
