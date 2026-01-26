import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', '.cloned-sources'],
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@protocol': resolve(__dirname, 'src/protocol'),
      '@ui': resolve(__dirname, 'src/ui'),
    },
  },
})
