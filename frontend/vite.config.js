// =====================================================================
// Vite тохиргоо
//   npm run dev        → http://localhost:5173
//   npm run dev:https  → https://<компьютерийн IP>:5173 (утасны камераар QR уншуулахад)
// /api хүсэлтүүд backend (5000) руу дамжина.
// =====================================================================
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

const https = process.env.HTTPS === '1';

export default defineConfig({
  plugins: [react(), ...(https ? [basicSsl()] : [])],
  server: {
    port: 5173,
    host: https,
    proxy: {
      '/api': { target: process.env.API_TARGET ?? 'http://localhost:5000', changeOrigin: true },
    },
  },
});
