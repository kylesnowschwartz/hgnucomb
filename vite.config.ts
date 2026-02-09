import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'hgnucomb',
        short_name: 'hgnucomb',
        description: 'Spatial terminal multiplexer with AI agent orchestration',
        theme_color: '#1e1e2e',
        background_color: '#1e1e2e',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      devOptions: {
        enabled: true,
      },
      workbox: {
        // Precache nothing -- hgnucomb requires a live WebSocket server,
        // offline support is not the goal. The SW exists solely to satisfy
        // Chrome's install prompt requirement for standalone mode.
        // NetworkOnly = never cache, just pass through. Workbox requires at
        // least one rule or it refuses to generate the SW.
        globPatterns: [],
        navigateFallback: null,
        runtimeCaching: [{
          urlPattern: /^https?:\/\/localhost/,
          handler: 'NetworkOnly',
        }],
      },
    }),
  ],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@protocol': resolve(__dirname, 'src/protocol'),
      '@features': resolve(__dirname, 'src/features'),
      '@theme': resolve(__dirname, 'src/theme'),
      '@integration': resolve(__dirname, 'src/integration'),
    },
  },
  server: {
    watch: {
      // Ignore worktree directories - they contain full project copies
      // that would otherwise trigger infinite reload loops
      ignored: ['**/.worktrees/**'],
    },
  },
})
