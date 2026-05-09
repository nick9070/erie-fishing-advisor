import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: false, // we manage manifest.json ourselves in /public
      workbox: {
        // Cache the app shell and API responses for offline resilience
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[a-z.]+openweathermap\.org\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'weather-cache',
              expiration: { maxAgeSeconds: 600 },  // 10 min
            },
          },
          {
            urlPattern: /^https:\/\/[a-z.]+tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 604800 },  // 1 week
            },
          },
          {
            urlPattern: /\/api\/(spots|conditions|forecast)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxAgeSeconds: 600 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  define: {
    // Allow overriding API base URL via env variable for production deployment
    __API_BASE__: JSON.stringify(process.env.VITE_API_BASE ?? ''),
  },
})
