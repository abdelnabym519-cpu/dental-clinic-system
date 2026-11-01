import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{js,ts,tsx}'],
    exclude: ['node_modules', '.next', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['lib/**/*.ts', 'app/api/**/*.ts', 'components/**/*.tsx'],
      exclude: ['node_modules', '.next', 'tests/**'],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // R1a: same bare specifier the app build aliases (next.config.js).
      // Vite has to be able to RESOLVE it even when a test mocks it, otherwise
      // the import fails at transform time before vi.mock can intercept.
      'rao-odontogram': path.resolve(
        __dirname,
        'vendor/react-advanced-odontogram/src/index.ts',
      ),
    },
  },
})
