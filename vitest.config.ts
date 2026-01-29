import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'shared/**/*.test.ts', 'server/**/*.test.ts'],
    exclude: ['node_modules', '.cloned-sources', 'server/node_modules'],
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@protocol': resolve(__dirname, 'src/protocol'),
      '@features': resolve(__dirname, 'src/features'),
      '@theme': resolve(__dirname, 'src/theme'),
      '@integration': resolve(__dirname, 'src/integration'),
    },
  },
})
