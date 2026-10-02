import { describe, it, expect } from 'vitest'
import { isPrismaFallback, prisma } from '@/lib/prisma'

/**
 * Runtime-defect regression (RT-R1): the fallback flag used to be MODULE
 * state while the client was cached on globalThis — route chunks that only
 * saw the globally cached client reported `isPrismaFallback() === false`,
 * and /api/ready answered 200 'database: ok' with NO database at all.
 * The flag now lives on globalThis beside the client it describes.
 */
function generatedClientMissing(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@prisma/client') as { PrismaClient?: unknown }
    return typeof mod.PrismaClient !== 'function'
  } catch {
    return true
  }
}

describe('prisma fallback honesty', () => {
  it('reports the fallback exactly when the generated client is unavailable (global flag)', () => {
    expect(isPrismaFallback()).toBe(generatedClientMissing())
    expect(prisma).toBeDefined()
  })
})
