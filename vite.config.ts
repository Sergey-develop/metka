import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/; native (Capacitor) and local builds use /
  base: process.env.VITE_BASE ?? '/',
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
  build: {
    target: ['es2022', 'safari15', 'chrome100'],
    sourcemap: false,
  },
})
