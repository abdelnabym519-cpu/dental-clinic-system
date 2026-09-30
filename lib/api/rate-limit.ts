/**
 * Phase 11 — Reusable audit-log-backed rate limiter (§41).
 *
 * ONE limiter implementation; the three AI routes already use this exact
 * pattern inline — this module extracts it so additional endpoints (uploads,
 * workflow triggers, knowledge ingestion) can adopt it without new semantics.
 * Backing store: AuditLog rows (tenant+user scoped) — no new infrastructure.
 * Rate limiting is NEVER a substitute for authorization: callers still pass
 * requireAuthAndRole first.
 */

export type RateLimitDeps = {
  client: {
    auditLog: {
      count: (args: {
        where: {
          hospitalId: string
          userId: string
          action: string
          createdAt: { gte: Date }
        }
      }) => Promise<number>
    }
  }
}

export type RateLimitResult = {
  allowed: boolean
  used: number
  limit: number
  windowSec: number
}

export async function checkRateLimit(
  deps: RateLimitDeps,
  scope: { hospitalId: string; userId: string; action: string },
  limit: number,
  windowSec = 60,
  now = new Date(),
): Promise<RateLimitResult> {
  const since = new Date(now.getTime() - windowSec * 1000)
  const used = await deps.client.auditLog.count({
    where: { hospitalId: scope.hospitalId, userId: scope.userId, action: scope.action, createdAt: { gte: since } },
  })
  return { allowed: used < limit, used, limit, windowSec }
}
