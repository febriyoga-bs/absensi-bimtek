import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

/**
 * Kamera realtime (getUserMedia). Tidak ada opsi unggah file/galeri —
 * foto hanya bisa diambil langsung dari kamera saat itu juga, lalu diberi
 * watermark (nama, waktu, koordinat, kode unik) yang dibakar ke gambar.
 */
const CameraCapture = forwardRef(function CameraCapture({ onReady }, ref) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Browser tidak mendukung kamera. Gunakan Chrome/Safari terbaru dan buka lewat HTTPS.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 853 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setReady(true);
        onReady?.(stream.getVideoTracks()[0]?.label || '');
      } catch (e) {
        setError(
          e.name === 'NotAllowedError'
            ? 'Izin kamera ditolak. Izinkan akses Kamera di pengaturan browser lalu muat ulang halaman.'
            : 'Kamera tidak dapat dibuka. Tutup aplikasi lain yang memakai kamera lalu coba lagi.'
        );
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useImperativeHandle(ref, () => ({
    /** @param {string[]} lines baris teks watermark */
    capture(lines) {
      const v = videoRef.current;
      if (!v || !v.videoWidth) return null;
      const w = Math.min(v.videoWidth, 480);
      const h = Math.round((v.videoHeight / v.videoWidth) * w);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      // cermin seperti tampilan selfie
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(v, 0, 0, w, h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      const fs = Math.max(14, Math.round(w / 34));
      const pad = fs * 0.6;
      const boxH = lines.length * fs * 1.35 + pad * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, h - boxH, w, boxH);
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${fs}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      lines.forEach((l, i) => ctx.fillText(l, pad, h - boxH + pad + i * fs * 1.35, w - pad * 2));
      return c.toDataURL('image/jpeg', 0.75);
    },
  }));

  if (error) return <div className="camera camera--error">{error}</div>;
  return (
    <div className="camera">
      <video ref={videoRef} playsInline muted autoPlay />
      {!ready && <div className="camera__loading">Membuka kamera…</div>}
      <div className="camera__guide" />
    </div>
  );
});

export default CameraCapture;
