import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

/**
 * Fallback SPA kedua untuk Vercel: salin index.html → 404.html.
 * Bila rewrite di vercel.json tidak menangkap alamat seperti /admin/absensi atau /absen/panitia
 * saat di-reload, Vercel menyajikan 404.html (= aplikasi React) dan React Router menampilkan halaman yang benar.
 */
const spaFallback = () => ({
  name: 'spa-404-fallback',
  closeBundle() {
    const dist = path.resolve(__dirname, 'dist');
    const index = path.join(dist, 'index.html');
    if (fs.existsSync(index)) fs.copyFileSync(index, path.join(dist, '404.html'));
  },
});

export default defineConfig({
  plugins: [react(), spaFallback()],
  server: {
    host: true, // agar bisa dibuka dari HP di jaringan yang sama
    proxy: { '/api': 'http://localhost:3000' },
  },
});
