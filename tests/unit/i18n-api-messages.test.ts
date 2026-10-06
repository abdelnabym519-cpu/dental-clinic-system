// @ts-nocheck
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translateText } from '@/lib/i18n/dictionary'

// ---------------------------------------------------------------------------
// The API's own error text reaches the DOM verbatim: client code does
// `throw new Error(data.error || '…')` and the toast viewport / error slot
// translates whatever string arrives. So a server message needs a dictionary
// entry, not code. This test walks every API route and proves that the plain
// string literals they return all resolve to Arabic, so no failure response can
// paint English in Arabic mode.
// ---------------------------------------------------------------------------

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : walk(f)
    return e.name.endsWith('.ts') ? [f] : []
  })
}

// Accepted Latin, deliberately: request-field identifiers echoed back for developers,
// brand/format tokens, and enum values that are data rather than copy.
const ACCEPTED = new Set([
  'JSON', 'SMS', 'OTP', 'IBAN', 'PDF', 'CSV', 'Excel', 'token', 'orderId', 'paymentId', 'claimId',
  'doctorId', 'appointmentId', 'deviceId', 'consultationId', 'templateId', 'invoiceId', 'roomName',
  'scheduleId', 'risk_score', 'cancel', 'retry', 'annotations', 'shifts', 'command', 'payment',
])

describe('API error messages are Arabic-resolvable', () => {
  const files = walk('app/api')
  const LITERAL = /(?:error|message)\s*:\s*'([^'\n]{4,120})'/g
  const TEMPLATE = /(?:error|message)\s*:\s*`([^`\n]{4,160})`/g

  it('returns every prose error string as a translatable key', () => {
    const offenders: string[] = []
    let audited = 0
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      for (const m of src.matchAll(LITERAL)) {
        const lit = m[1].trim()
        const words = lit.match(/[A-Za-z]{3,}/g)
        if (!words || !words.some((w) => !ACCEPTED.has(w))) continue
        audited++
        const ar = translateText('ar-EG', lit)
        if (!/[\u0600-\u06FF]/.test(ar)) offenders.push(`${file}: ${lit}`)
        // and English must render the sentence exactly as the server wrote it
        expect(translateText('en-EG', lit)).toBe(lit)
      }
    }
    // non-vacuity: this is a real sweep over the whole API surface
    expect(audited).toBeGreaterThan(300)
    expect(offenders).toEqual([])
  })

  it('leaves only data-interpolated messages untranslated, and never more than today', () => {
    // A message like `Room is already booked by appointment ${no} at ${time}` embeds live
    // values, so no dictionary key can match it. Fixing that class needs an API contract
    // change (message code + params) or client-side composition - behaviour work, not a
    // label pass. The count is pinned so it cannot silently grow.
    let templates = 0
    const samples: string[] = []
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      for (const m of src.matchAll(TEMPLATE)) {
        if (!/\$\{/.test(m[1])) {
          // a template literal with no interpolation is just a string - it must translate
          const lit = m[1].trim()
          if (/[A-Za-z]{4,}\s+[A-Za-z]{4,}/.test(lit)) {
            expect(/[\u0600-\u06FF]/.test(translateText('ar-EG', lit))).toBe(true)
          }
          continue
        }
        templates++
        if (samples.length < 4) samples.push(`${file}: ${m[1].trim().slice(0, 60)}`)
      }
    }
    expect(templates).toBeLessThanOrEqual(48)
    expect(samples.length).toBeGreaterThan(0)
  })

  it('paints the shipped Arabic wording for the messages users actually hit', () => {
    // Public payment link (the page renders data.error straight into an error slot)
    expect(translateText('ar-EG', 'Invalid payment link')).toBe('رابط الدفع غير صالح')
    expect(translateText('ar-EG', 'This payment link has expired')).toBe('انتهت صلاحية رابط الدفع هذا')
    expect(translateText('ar-EG', 'Staff limit reached')).toBe('تم الوصول إلى الحد الأقصى لعدد الموظفين')
    expect(translateText('ar-EG', 'Internal server error')).toBe('خطأ داخلي في الخادم')
    expect(translateText('ar-EG', 'Insufficient permissions')).toBe('الصلاحيات غير كافية')
    expect(translateText('ar-EG', 'You do not have permission to use this skill')).toBe('ليست لديك صلاحية استخدام هذه المهارة')
    // identifiers stay as typed, sentence around them is Arabic
    expect(translateText('ar-EG', 'claimId is required')).toBe('حقل claimId مطلوب')
  })
})
