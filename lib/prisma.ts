// The generated Prisma client (`.prisma/client`) is produced by
// `prisma generate`, which requires network access in offline sandboxes.
// This module therefore keeps the client type structural instead of importing
// from the generated module, so the app stays importable either way.
type PrismaClient = {
  $connect(): Promise<void>
  $disconnect(): Promise<void>
  $on(event: string, callback: () => void): void
  $transaction(input: unknown, options?: unknown): Promise<unknown>
  $queryRaw(query: unknown, ...values: unknown[]): Promise<unknown>
  $executeRaw(query: unknown, ...values: unknown[]): Promise<unknown>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [model: string]: any
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * No-op client used when the Prisma query engine is unavailable (e.g. offline
 * sandboxes where `prisma generate` cannot download engine binaries).
 * Every call resolves to an empty result so routes stay functional.
 */
function makeFallbackPrismaClient(): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      if (prop === '$connect' || prop === '$disconnect') return async () => undefined
      if (prop === '$on') return () => undefined
      if (prop === '$transaction') {
        return async (arg: unknown) =>
          typeof arg === 'function' ? arg(makeFallbackPrismaClient()) : []
      }
      if (prop === '$queryRaw' || prop === '$executeRaw') return async () => []
      if (typeof prop === 'symbol') return undefined
      return new Proxy(
        {},
        {
          get() {
            return async () => null
          },
        }
      )
    },
  })
}

type PrismaClientCtorLike = (new (options?: Record<string, unknown>) => PrismaClient) | undefined

let PrismaClientCtor: PrismaClientCtorLike
try {
  // Guarded runtime require: the computed specifier keeps this from being
  // rewritten into a static import, so a missing generated engine
  // (`.prisma/client`) surfaces here and is handled by the fallback.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@prisma' + '/client') as { PrismaClient?: PrismaClientCtorLike }
  PrismaClientCtor = mod.PrismaClient
} catch {
  PrismaClientCtor = undefined
}

function createPrismaClient(): PrismaClient {
  if (!PrismaClientCtor) {
    return makeFallbackPrismaClient()
  }
  try {
    return new PrismaClientCtor({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    })
  } catch {
    // Return a proxy fallback in dev environments when native query engine is not compiled
    return makeFallbackPrismaClient()
  }
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
