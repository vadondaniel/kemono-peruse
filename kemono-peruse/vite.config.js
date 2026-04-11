import { cwd } from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, cwd(), '')

  const toPort = (value, fallback) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  const proxyPort = toPort(env.PROXY_PORT, 3001)
  const devServerPort = toPort(env.VITE_DEV_SERVER_PORT || env.VITE_PORT, 5173)
  const previewPort = toPort(env.VITE_PREVIEW_PORT, 4173)

  return {
    plugins: [react()],
    server: {
      port: devServerPort,
      allowedHosts: ['peruse.lan','kemono.peruse'],
      proxy: {
        '/api/proxy/kemono': {
          target: `http://localhost:${proxyPort}`,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    preview: {
      port: previewPort,
      allowedHosts: ['peruse.lan','kemono.peruse'],
    },
  }
})
