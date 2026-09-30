/**
 * Phase 11 — Canonical typed API error contract (§40).
 *
 * Every machine-facing API error: { code, message, requestId, details? }.
 * Messages are localization keys when a catalog entry exists (Arabic/English
 * support through the existing i18n dictionary); stacks, database errors and
 * filesystem paths NEVER leave the server.
 */
import type { NextResponse } from 'next/server'

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INTERNAL'

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode
    message: string
    requestId: string
    details?: Record<string, unknown>
  }
}

/** Arabic/English message catalog for the generic codes (i18n keys). */
export const API_ERROR_MESSAGES: Record<ApiErrorCode, { en: string; ar: string }> = {
  UNAUTHORIZED: { en: 'Authentication required.', ar: 'المصادقة مطلوبة.' },
  FORBIDDEN: { en: 'You do not have permission for this action.', ar: 'لا تملك صلاحية لهذا الإجراء.' },
  RATE_LIMITED: { en: 'Too many requests. Try again shortly.', ar: 'طلبات كثيرة جدًا. حاول بعد قليل.' },
  VALIDATION_ERROR: { en: 'The request payload is invalid.', ar: 'بيانات الطلب غير صالحة.' },
  NOT_FOUND: { en: 'The requested resource was not found.', ar: 'المورد المطلوب غير موجود.' },
  CONFLICT: { en: 'The request conflicts with the current state.', ar: 'الطلب يتعارض مع الحالة الحالية.' },
  DEPENDENCY_UNAVAILABLE: { en: 'A required service is temporarily unavailable.', ar: 'إحدى الخدمات المطلوبة غير متاحة حاليًا.' },
  TIMEOUT: { en: 'The operation took too long and was stopped.', ar: 'استغرقت العملية وقتًا طويلاً وتم إيقافها.' },
  INTERNAL: { en: 'An internal error occurred.', ar: 'حدث خطأ داخلي.' },
}

const STATUS_FOR: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DEPENDENCY_UNAVAILABLE: 503,
  TIMEOUT: 504,
  INTERNAL: 500,
}

/** Localize a generic code using the existing dictionary (falls back to English). */
function localizedMessage(code: ApiErrorCode, locale?: string): string {
  const entry = API_ERROR_MESSAGES[code]
  if (!entry) return code
  if (locale && /^ar/i.test(locale)) return entry.ar
  return entry.en
}

/**
 * Build the canonical error JSON. `internalDetail` stays server-side:
 * the contract deliberately does NOT forward it.
 */
export function apiError(
  code: ApiErrorCode,
  requestId: string,
  opts: { locale?: string; message?: string; details?: Record<string, unknown>; internalDetail?: string } = {},
): { status: number; body: ApiErrorBody; internalDetail?: string } {
  const message = opts.message ?? localizedMessage(code, opts.locale)
  return {
    status: STATUS_FOR[code],
    body: {
      error: {
        code,
        message,
        requestId,
        ...(opts.details ? { details: opts.details } : {}),
      },
    },
    internalDetail: opts.internalDetail,
  }
}

/** NextResponse wrapper that also echoes the correlation id. */
export function apiErrorResponse(
  code: ApiErrorCode,
  requestId: string,
  opts: { locale?: string; message?: string; details?: Record<string, unknown>; internalDetail?: string } = {},
): NextResponse {
  // Imported lazily to keep this module importable from edge-safe contexts.
  const { NextResponse } = require('next/server') as typeof import('next/server')
  const { status, body } = apiError(code, requestId, opts)
  const res = NextResponse.json(body, { status })
  res.headers.set('x-correlation-id', requestId)
  res.headers.set('Cache-Control', 'no-store')
  return res
}
