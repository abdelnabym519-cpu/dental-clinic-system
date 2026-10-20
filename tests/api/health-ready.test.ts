import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'

// vi.hoisted keeps this state reachable from the vi.mock factory below, which
// Vitest hoists above every other statement in the file.
const { fallbackState } = vi.hoisted(() => ({ fallbackState: { value: false } }))

vi.mock('@/lib/prisma', () => ({
  prisma,
  default: prisma,
  // lib/prisma exposes this so callers can tell the real Prisma client apart
  // from the null-returning stand-in used when the generated client is
  // missing. /api/ready gates on it.
  isPrismaFallback: () => fallbackState.value,
}))

const health = await import('@/app/api/health/route')
const ready = await import('@/app/api/ready/route')

describe('Liveness and readiness probes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Every test starts on a real Prisma client unless it opts into fallback.
    fallbackState.value = false
  })

  describe('GET /api/health', () => {
    it('returns 200 with an ok status', async () => {
      const res = await health.GET()
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.status).toBe('ok')
      expect(typeof body.uptime).toBe('number')
      expect(typeof body.timestamp).toBe('string')
    })

    it('does not touch the database', async () => {
      // The whole point of splitting liveness from readiness. If this probe
      // queried the database, a database blip would make an orchestrator kill
      // and restart healthy containers.
      await health.GET()
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })

    it('is not cached', async () => {
      const res = await health.GET()
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    })
  })

  describe('GET /api/ready', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      errorSpy.mockRestore()
    })

    it('returns 200 when the database responds', async () => {
      ;(prisma.$queryRaw as any).mockResolvedValue([{ 1: 1 }])

      const res = await ready.GET()
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.status).toBe('ready')
      expect(body.checks.database).toBe('ok')
    })

    it('returns 503 rather than throwing when the database is unreachable', async () => {
      ;(prisma.$queryRaw as any).mockRejectedValue(new Error("Can't reach database server"))

      // Must resolve, not reject. An unhandled throw here surfaces as a 500,
      // which is indistinguishable from the app being broken some other way.
      const res = await ready.GET()
      expect(res.status).toBe(503)

      const body = await res.json()
      expect(body.status).toBe('not_ready')
      expect(body.checks.database).toBe('error')
    })

    it('does not leak database connection details in the response', async () => {
      ;(prisma.$queryRaw as any).mockRejectedValue(
        new Error('connect ECONNREFUSED 10.0.0.5:3306 user=admin password=hunter2')
      )

      const res = await ready.GET()
      const raw = JSON.stringify(await res.json())

      // The endpoint is unauthenticated, so a driver error must not reach it.
      expect(raw).not.toContain('10.0.0.5')
      expect(raw).not.toContain('hunter2')
      expect(raw).not.toContain('ECONNREFUSED')
    })

    it('logs the underlying failure for operators', async () => {
      const cause = new Error('pool exhausted')
      ;(prisma.$queryRaw as any).mockRejectedValue(cause)

      await ready.GET()

      // Detail belongs in the logs, not the response body.
      expect(errorSpy).toHaveBeenCalledWith('[ready] database check failed:', cause)
    })

    it('is not cached', async () => {
      ;(prisma.$queryRaw as any).mockResolvedValue([{ 1: 1 }])

      const res = await ready.GET()
      expect(res.headers.get('Cache-Control')).toBe('no-store')
    })

    describe('when the Prisma client is in fallback mode', () => {
      // Fallback mode is what lib/prisma falls back to when the generated
      // client is missing: every query resolves to null / an empty result
      // instead of throwing.
      beforeEach(() => {
        fallbackState.value = true
      })

      it('returns 503 rather than advertising a ready instance', async () => {
        const res = await ready.GET()
        expect(res.status).toBe(503)

        const body = await res.json()
        expect(body.status).toBe('not_ready')
        expect(body.checks.database).toBe('unavailable')
      })

      it('never reports the database as healthy', async () => {
        const body = await (await ready.GET()).json()

        // storage may legitimately read 'ok' in this state — only the database
        // verdict is allowed to gate readiness.
        expect(body.status).not.toBe('ready')
        expect(body.checks.database).not.toBe('ok')
        expect(body.checks.database).toBe('unavailable')
      })

      it('fails closed WITHOUT probing the database', async () => {
        // The regression this guards: the stand-in client resolves every query
        // to an empty result, so a probe first would report 200 'ok' with no
        // database behind it. The flag has to be consulted before any query.
        ;(prisma.$queryRaw as any).mockResolvedValue([{ 1: 1 }])

        const res = await ready.GET()
        expect(res.status).toBe(503)
        expect(prisma.$queryRaw).not.toHaveBeenCalled()
      })

      it('is not cached', async () => {
        const res = await ready.GET()
        expect(res.headers.get('Cache-Control')).toBe('no-store')
      })
    })
  })
})
