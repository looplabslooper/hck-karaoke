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
    port: 5175,
    proxy: {
      '/api': 'http://localhost:8080',
      '/library': 'http://localhost:8080',
      '/templates': 'http://localhost:8080',
      // Herramienta standalone (HTML suelto, sin dependencias) que solo
      // existe en el server — sin este proxy, en dev (:5175) Vite no la
      // conoce y cae al fallback de la SPA, que reaparece en la página por
      // defecto en vez de la herramienta. En producción esto no pasa
      // porque todo se sirve del mismo origen (:8080).
      '/template-editor': 'http://localhost:8080',
    },
  },
})
