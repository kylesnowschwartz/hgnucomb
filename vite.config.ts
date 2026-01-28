import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
