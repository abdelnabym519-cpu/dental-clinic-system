/**
 * Phase 11 — Canonical structured logging policy (§39).
 *
 * ONE logger. Machine-readable JSON lines, severity-aware, correlation-aware,
 * PHI-minimized and secret-free by construction:
 *  - keys matching SECRET/PHI patterns are redacted BEFORE serialization
 *    (password, token, secret, key, authorization, cookie, audio, transcript,
 *     wav, answerText is ALLOWED — agent answers are decision support, but
 *     raw transcripts/audio never log);
 *  - classifies DEBUG/INFO/WARN/ERROR/SECURITY/AUDIT;
 *  - never logs stack traces to stdout in production (message only);
 *  - correlation id is passed explicitly (edge-safe, no AsyncLocalStorage).
 */
import { versionStamp } from '@/lib/config/version'

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'SECURITY' | 'AUDIT'

const REDACT_KEY = /pass(word)?|secret|token|api[_-]?key|authorization|cookie|credential|audio|transcript|wav|ssn|national.?id/i

export type LogFields = Record<string, unknown>

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]'
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1))
  if (value instanceof Error) return { name: value.name, message: value.message }
  if (typeof value === 'object') {
    const out: LogFields = {}
    for (const [k, v] of Object.entries(value as LogFields)) {
      out[k] = REDACT_KEY.test(k) ? '[redacted]' : redact(v, depth + 1)
    }
    return out
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…[truncated]`
  return value
}

export type Logger = {
  debug: (msg: string, fields?: LogFields) => void
  info: (msg: string, fields?: LogFields) => void
  warn: (msg: string, fields?: LogFields) => void
  error: (msg: string, fields?: LogFields) => void
  security: (msg: string, fields?: LogFields) => void
  audit: (msg: string, fields?: LogFields) => void
}

const SEVERITY_EMITTED: Record<LogLevel, number> = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40, SECURITY: 40, AUDIT: 20 }

function minSeverity(): number {
  const env = process.env.LOG_LEVEL?.toUpperCase()
  return env && env in SEVERITY_EMITTED ? SEVERITY_EMITTED[env as LogLevel] : SEVERITY_EMITTED.INFO
}

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  if (SEVERITY_EMITTED[level] < minSeverity()) return
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    app: 'dentora',
    version: versionStamp(),
    ...(fields ? (redact(fields) as LogFields) : {}),
  })
  // stdout is the log stream in every container deployment; errors keep the
  // same stream so a single collector sees one JSON-line format.
  process.stdout.write(`${line}\n`)
}

/** Create a logger bound to a correlation id + component. */
export function createLogger(correlationId: string | null, component: string): Logger {
  const base = { correlationId: correlationId ?? null, component }
  return {
    debug: (m, f) => emit('DEBUG', m, { ...base, ...f }),
    info: (m, f) => emit('INFO', m, { ...base, ...f }),
    warn: (m, f) => emit('WARN', m, { ...base, ...f }),
    error: (m, f) => emit('ERROR', m, { ...base, ...f }),
    security: (m, f) => emit('SECURITY', m, { ...base, ...f }),
    audit: (m, f) => emit('AUDIT', m, { ...base, ...f }),
  }
}

export const logger: Logger = createLogger(null, 'app')
