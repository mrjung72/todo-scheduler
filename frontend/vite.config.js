import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 문서 원본은 프로젝트 루트 docs/ 한 곳에서만 관리 — 빌드 시 dist로 복사됨
  publicDir: '../docs',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
