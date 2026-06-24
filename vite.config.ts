import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Relative base ('./') only for the production build (so it runs from file:// in the Capacitor
// WebView). The dev server needs an absolute base ('/') — a relative base breaks module/HMR URLs,
// especially behind a tunnel (blank page).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react(), tailwindcss()],
  // host: true exposes the dev server on the LAN; allowedHosts lets tunnel domains
  // (localtunnel / cloudflare / ngrok) through Vite's host check for mobile testing.
}))
