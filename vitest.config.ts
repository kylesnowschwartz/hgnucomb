import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@protocol': resolve(__dirname, 'src/protocol'),
      '@ui': resolve(__dirname, 'src/ui'),
    },
  },
})
