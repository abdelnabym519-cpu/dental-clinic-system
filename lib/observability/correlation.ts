/**
 * Phase 11 — Request correlation IDs (§36).
 *
 * ONE typed correlation identity propagated HTTP → Agent → tools → workflows
 * → AI jobs → voice → audit → logs. Client-supplied values are accepted ONLY
 * when they match the safe shape (`[A-Za-z0-9_-]{8,64}`) — arbitrary
 * user-controlled strings are never trusted as correlation identity (a fresh
 * server-generated id is minted otherwise).
 */

const CORRELATION_RE = /^[A-Za-z0-9_-]{8,64}$/

/** A freshly minted correlation id (typed, opaque, safe to echo). */
export function newCorrelationId(now = new Date()): string {
  const time = now.getTime().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `c-${time}-${rand}`
}

/** Accept a client id only when it matches the safe shape; otherwise mint. */
export function sanitizeCorrelationId(input: unknown): string {
  return typeof input === 'string' && CORRELATION_RE.test(input) ? input : newCorrelationId()
}

/** Extract + sanitize from an HTTP request (x-correlation-id then x-request-id). */
export function correlationFromRequest(req: Request): string {
  const header = req.headers.get('x-correlation-id') ?? req.headers.get('x-request-id')
  return sanitizeCorrelationId(header)
}

/** Response echo so clients/support can quote the id back. */
export function withCorrelationEcho(res: Response, correlationId: string): Response {
  res.headers.set('x-correlation-id', correlationId)
  return res
}
