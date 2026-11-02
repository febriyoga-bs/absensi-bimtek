import { useEffect, useState } from 'react';
import { Navigate, Link, useSearchParams } from 'react-router-dom';
import { api, adminToken } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import BrandMark from '../../components/BrandMark.jsx';

/** Tampilkan di proyektor / TV di meja registrasi masing-masing venue. */
export default function VenueCode() {
  const [params] = useSearchParams();
  const venueId = params.get('venue');
  const [venues, setVenues] = useState(null);
  const [data, setData] = useState(null);
  const [left, setLeft] = useState(0);
  const [info, setInfo] = useState(null);

  useEffect(() => { api('/info').then(setInfo).catch(() => {}); }, []);

  useEffect(() => {
    if (venueId) return;
    api('/admin/venues', { admin: true }).then((v) => setVenues(v.filter((x) => x.active))).catch(() => {});
  }, [venueId]);

  useEffect(() => {
    if (!venueId) return;
    let timer;
    const load = async () => {
      try {
        const d = await api(`/admin/venues/${venueId}/code`, { admin: true });
        setData(d);
        setLeft(d.expires_in);
        clearTimeout(timer);
        timer = setTimeout(load, d.expires_in * 1000 + 300);
      } catch { timer = setTimeout(load, 3000); }
    };
    load();
    const t = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000);
    return () => { clearTimeout(timer); clearInterval(t); };
  }, [venueId]);

  if (!adminToken.get()) return <Navigate to="/admin/login" replace />;

  // LO hanya punya satu venue → langsung tampilkan layar kodenya
  if (!venueId && venues?.length === 1) return <Navigate to={`/admin/kode-venue?venue=${venues[0].id}`} replace />;

  if (!venueId) {
    return (
      <div className="venue">
        <BrandMark size={84} className="venue__logo" />
        <div className="venue__title">{info?.event_name || 'BIMTEK Revitalisasi SD'}</div>
        <div className="venue__label">PILIH VENUE UNTUK LAYAR INI</div>
        <div className="venue__pick">
          {venues?.map((v) => (
            <Link key={v.id} to={`/admin/kode-venue?venue=${v.id}`}><Icon name="pin" />{v.name}</Link>
          ))}
          {venues && !venues.length && <p>Belum ada venue aktif.</p>}
        </div>
      </div>
    );
  }

  const code = data?.code || '------';
  return (
    <div className="venue">
      <BrandMark size={96} className="venue__logo" />
      <div className="venue__title">{info?.event_name || 'BIMTEK Revitalisasi SD'}</div>
      <div className="venue__name"><Icon name="pin" size={34} />{data?.venue.name || '…'}</div>
      <div className="venue__label">KODE VENUE ABSENSI</div>
      <div className="venue__code">{code.slice(0, 3)} {code.slice(3)}</div>
      <div className="venue__bar"><span style={{ width: `${(left / 30) * 100}%` }} /></div>
      <div className="venue__hint">Berganti dalam {left} detik · Buka {window.location.host} → Absen</div>
    </div>
  );
}
