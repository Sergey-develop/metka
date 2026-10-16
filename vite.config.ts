import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Vite defaults to the first resolution of "localhost" (often ::1 on Windows),
    // which some browsers/proxies don't try; bind IPv4 loopback explicitly.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    // MapLibre 6 loads its worker from `new URL('./maplibre-gl-worker.mjs', import.meta.url)`;
    // pre-bundling moves the module into .vite/deps without the worker file → "Worker failed to load"
    exclude: ['maplibre-gl'],
  },
  build: {
    target: ['es2022', 'safari15', 'chrome100'],
    sourcemap: false,
    // MapLibre (~1 MB) is lazy-loaded with the map route
    chunkSizeWarningLimit: 1100,
  },
})
