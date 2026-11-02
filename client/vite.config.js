import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // agar bisa dibuka dari HP di jaringan yang sama
    proxy: { '/api': 'http://localhost:3000' },
  },
});
