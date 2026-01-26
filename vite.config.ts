import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@protocol': resolve(__dirname, 'src/protocol'),
      '@ui': resolve(__dirname, 'src/ui'),
      '@state': resolve(__dirname, 'src/state'),
      '@terminal': resolve(__dirname, 'src/terminal'),
    },
  },
})
