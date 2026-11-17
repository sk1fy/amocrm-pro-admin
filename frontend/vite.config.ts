import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  root: mode === 'managers' ? 'manager' : undefined,
  build: mode === 'managers' ? { outDir: '../dist-managers', emptyOutDir: true } : undefined,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: false,
      },
    },
  },
}))
