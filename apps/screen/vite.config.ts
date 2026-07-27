import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // En dev, screen (Vite, :5173) y server (Node, :8080) son orígenes
      // distintos. En producción/Tauri sirven desde el mismo origen y esto
      // no hace falta, pero mantenemos las URLs relativas iguales en ambos casos.
      '/library': 'http://localhost:8080',
    },
  },
})
