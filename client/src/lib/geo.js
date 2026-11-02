/**
 * Memantau GPS secara terus-menerus (watchPosition) dan menyimpan sampel.
 * Banyak sampel dibutuhkan server untuk mendeteksi fake GPS:
 * GPS asli selalu bergoyang sedikit, mock location biasanya statis sempurna.
 */
export function startGeoWatch(onUpdate) {
  const samples = [];
  if (!('geolocation' in navigator)) {
    onUpdate({ error: 'Perangkat tidak mendukung GPS.', samples });
    return { stop() {}, samples };
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      samples.push({
        lat: c.latitude,
        lng: c.longitude,
        accuracy: c.accuracy,
        altitude: c.altitude,
        altitudeAccuracy: c.altitudeAccuracy,
        speed: c.speed,
        ts: pos.timestamp,
        at: Date.now(),
      });
      if (samples.length > 30) samples.shift();
      onUpdate({ error: null, samples: [...samples], last: samples[samples.length - 1] });
    },
    (err) => {
      const msg =
        err.code === 1
          ? 'Izin lokasi ditolak. Buka pengaturan browser → izinkan Lokasi untuk situs ini.'
          : err.code === 3
            ? 'GPS belum mendapatkan sinyal. Pastikan GPS aktif dan coba di area terbuka.'
            : 'Lokasi tidak tersedia. Aktifkan GPS / Lokasi pada perangkat.';
      onUpdate({ error: msg, samples: [...samples] });
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
  );
  return { stop: () => navigator.geolocation.clearWatch(id), samples };
}

export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
