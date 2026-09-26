import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Dedicated runner for the real-stack imaging AI E2E
 * (tests/api/e2e-imaging-ai.test.ts).
 *
 * Differences from the default config, all deliberate:
 *   - environment: 'node'  — real fetch / FormData / File / fs (the DOM setup
 *     in tests/setup.ts is not available and not wanted here)
 *   - setupFiles: []       — no `global.fetch = vi.fn()` mock, and no
 *     `process.env.DATABASE_URL = '…_test'` override. The test process reads
 *     the real .env (dotenv) so Prisma and the S3 storage driver point at the
 *     live MySQL and MinIO.
 *   - generous timeouts — a real CPU inference + MinIO round-trips take longer
 *     than a unit test.
 *
 * Run (Windows PowerShell):
 *   $env:E2E_LOCAL='1'; $env:E2E_DOCTOR_EMAIL='...'; $env:E2E_DOCTOR_PASSWORD='...'
 *   npx vitest run --config vitest.e2e.config.ts
 *
 * Without E2E_LOCAL=1 the suite skips cleanly (0 tests) — it never reports a
 * fake pass and never touches live services.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [],
    include: ['tests/api/e2e-imaging-ai.test.ts'],
    testTimeout: 180000,
    hookTimeout: 180000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
