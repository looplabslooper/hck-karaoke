import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // El kiosco corre siempre en un Chrome moderno específico (modo --kiosk,
  // ver DECISIONES-STACK.md §6) — no hace falta transpilar para navegadores
  // viejos. Además esquiva un bug real de esbuild con el target multi-browser
  // por defecto de Vite, que rompe el build con "Transforming destructuring...
  // is not supported yet" en destructuring completamente estándar.
  build: {
    target: 'es2022',
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:8080',
      '/library': 'http://localhost:8080',
    },
  },
})
