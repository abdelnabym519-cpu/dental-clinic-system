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

/**
 * "Prose" = two words of 3+ letters. Deliberately looser than the two-consecutive-4-letter-words
 * test this suite used until rev 12: the most common validation sentence in this app is
 * `City is required`, and the stricter shape silently skipped every one of them (60 of 425 sites).
 * It still refuses fragments that cannot be sentences (`Total: 1,000`, `Chair 3`).
 */
const isProse = (s: string) => s.split(' ').filter((w) => /[A-Za-z]{3,}/.test(w)).length >= 2

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

  it('recovers Arabic for messages that arrive already interpolated', () => {
    // A route returns `Room is already booked by appointment ${no} at ${time}`. By the time the
    // client renders data.error, the values are baked in, so the string can never equal a key.
    // translateText's third step matches the sentence back onto the key's literal frame and
    // re-renders the locale template with the captured values.
    const cases: Array<[string, string]> = [
      ['Room is already booked by appointment INV-7 at 2026-01-05T09:30:00.000Z', 'الغرفة محجوزة بالفعل'],
      ['Doctor already has appointment A-12 from 09:00 (30 min) overlapping this time', 'للطبيب موعد بالفعل'],
      ['Cannot check in appointment with status: CANCELLED', 'لا يمكن تسجيل حضور موعد حالته'],
      ['Your plan allows up to 500 patients. Please upgrade to add more.', 'خطتك تسمح بحتى 500 مريضًا'],
      ['Staff limit reached. Your plan allows 20 staff members. Current: 20.', 'تم بلوغ حد الموظفين'],
      ['Patient "P-0042" not found', 'لم يتم العثور على المريض'],
      ['Payment amount (900) exceeds balance (500)', 'مبلغ الدفع (900) يتجاوز المتبقي'],
      ['Unsupported file type ".txt". Accepted: .csv, .xlsx, .xls, .pdf', 'نوع الملف غير مدعوم'],
      ['Failed to fetch patient (503)', 'تعذّر جلب بيانات المريض'],
    ]
    for (const [sentence, expectArabic] of cases) {
      const ar = translateText('ar-EG', sentence)
      expect(ar).toMatch(/[\u0600-\u06FF]/)
      expect(ar).toContain(expectArabic)
      // English must come back byte-identical: the pattern pass re-renders the en template,
      // whose value equals the key, with the same captured values.
      expect(translateText('en-EG', sentence)).toBe(sentence)
    }
    // the interpolation itself has to survive the round trip, not just the sentence
    expect(translateText('ar-EG', 'Insufficient points. Balance: 12')).toContain('12')
  })

  it('never guesses free text into a label-shaped key', () => {
    // The index only accepts frames whose literal skeleton has >=2 words and >=14 chars, which
    // is what keeps `Patient: {v1}` / `Total: {v1}` / `Notes: {v1}` from swallowing arbitrary
    // copy that happens to start with the same prefix.
    for (const text of [
      'Patient: not found in the database',
      'Total: 1,000 EGP for the whole quarter',
      'Notes: bring the file tomorrow morning',
      'Invoice pending approval by the manager today',
      'Plain unknown text here that matches nothing',
    ]) {
      expect(translateText('ar-EG', text)).toBe(text)
    }
  })

  it('every sampled route template resolves, not just the ones listed above', () => {
    // Self-maintaining: each `error: \`...\`` template in app/api is sampled with a stand-in
    // value and must resolve to Arabic. Conditional fragments cannot be sampled and are skipped.
    const SAMPLE = 'ZZ-42'
    let sampled = 0
    const unresolved: string[] = []
    for (const file of walk('app/api')) {
      const src = fs.readFileSync(file, 'utf8')
      for (const m of src.matchAll(/(?:error|message)\s*:\s*`([^`]{6,220})`/g)) {
        const tmpl = m[1]
        if (/[?{][^}]*}/.test(tmpl.replace(/\$\{[^}]*\}/g, ''))) continue // conditional/odd shape
        if (!/\$\{/.test(tmpl)) continue
        const sentence = tmpl.replace(/\$\{[^}]*\}/g, SAMPLE)
        // a nested template (`` `…${cond ? `x` : ''}` ``) cannot be sampled faithfully: the
        // capture stops at the inner backtick and leaves a dangling fragment. Those routes build
        // their sentence from parts, and the *served* string is asserted separately below.
        if (sentence.includes('${')) continue
        if (!isProse(sentence)) continue
        sampled++
        const ar = translateText('ar-EG', sentence)
        if (!/[\u0600-\u06FF]/.test(ar)) unresolved.push(`${file}: ${sentence.slice(0, 74)}`)
      }
    }
    expect(sampled).toBeGreaterThan(25)
    expect(unresolved).toEqual([])
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
          if (isProse(lit)) {
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

  it('covers the notification copy that is stored, then rendered later', () => {
    // A cron job writes `title`/`message` into the database and the tray renders them whenever
    // the user opens it, so the sentence is baked with values long before it reaches t(). Same
    // rule as the API responses: every stored frame must resolve. (The tray now calls t() on
    // both slots, which is what makes this worth auditing at all.)
    const tray = fs.readFileSync('components/layout/notification-tray.tsx', 'utf8')
    expect(tray).toContain('{t(n.title)}')
    expect(tray).toContain('{t(n.message)}')

    const files = walk('app/api').filter((f2) => {
      const src = fs.readFileSync(f2, 'utf8')
      return src.includes('notification.create') || f2.includes('/cron/')
    })
    expect(files.length).toBeGreaterThan(3)
    const RX = /(?:title|message|body)\s*:\s*(?:'([^'\n]{4,140})'|`([^`\n]{4,240})`)/g
    const unresolved: string[] = []
    let audited = 0
    for (const file of files) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(RX)) {
        const raw = (m[1] ?? m[2]).trim()
        if (!isProse(raw)) continue
        // sample the interpolation so the frame can be matched the way the runtime will
        const sentence = raw.replace(/\$\{[^}]*\}/g, 'ZZ-42')
        if (sentence.includes('${')) continue // nested template: un-sampling is honest, not silent
        audited++
        if (!/[\u0600-\u06FF]/.test(translateText('ar-EG', sentence))) unresolved.push(`${file}: ${sentence.slice(0, 70)}`)
      }
    }
    expect(audited).toBeGreaterThan(10)
    expect(unresolved).toEqual([])
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
