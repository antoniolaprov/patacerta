import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Codespaces serves each port from https://<codespace>-<port>.app.github.dev
  server: { allowedHosts: ['.app.github.dev'] },
})
