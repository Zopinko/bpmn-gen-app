import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/nl': 'http://127.0.0.1:8000',
      '/generate': 'http://127.0.0.1:8000',
      '/autogenerate': 'http://127.0.0.1:8000',
      '/frajer': 'http://127.0.0.1:8000',
      '/mentor': 'http://127.0.0.1:8000',
      '/telemetry': 'http://127.0.0.1:8000',
      '/ai': 'http://127.0.0.1:8000',
      '/controller': 'http://127.0.0.1:8000',
    }
  }
})
