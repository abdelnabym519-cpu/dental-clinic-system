// @ts-nocheck
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { translateText, dictionaries } from '@/lib/i18n/dictionary'

// ---------------------------------------------------------------------------
// Issue 6 — Arabic-only global sweep harness.
//
// The sweep found the product almost fully localized by the pass-1/2/3
// architecture (dotted keys + English reverse index + central toast
// localization), with a small set of genuine leaks. This file locks every
// leak class closed:
//
//   H1/H4  UI + medical-history labels resolve to Arabic through the
//          dictionary (source-level resolution audit of every t() call site).
//   H2/H6  API permission/validation messages are Arabic at source.
//   H3     Patient-facing prescription PDF strings (allergies/age line).
//   H5     Portal surfaces (password label, inline portal error slots).
//   H7     Inline error slots localize at render ({t(error)}).
//   H8     No system email / patient SMS body ships English prose.
//
// Technical identifiers (HTTP verbs, ESC, ids like MED-2024-12345, bank
// codes) are whitelisted — they are data, not product copy.
// ---------------------------------------------------------------------------

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = `${dir}/${e.name}`
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : walk(f)
    return /\.(tsx|ts)$/.test(e.name) ? [f] : []
  })
}

/** Decode the JS string escapes a raw source scan sees. */
function decodeJs(src: string): string {
  if (/\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}/.test(src)) {
    try {
      return JSON.parse(`"${src.replace(/(?<!\\)"/g, '\\"')}"`)
    } catch {
      /* fall through */
    }
  }
  return src.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

const TECHNICAL = /^(POST|GET|PUT|DELETE|PATCH|ESC|DENTAL|INV|REC|MED-\d{4}-\d+|NBEGEGCX|REG\d+)$/

/**
 * Intentional English (Issue 6 classification, category 2/3) — data, not copy:
 * example/placeholder emails and URLs, provider & product names, clinical
 * units, blood types, connection labels, and any real dictionary key whose
 * Arabic value is itself non-Arabic by design (#, x, y column heads, dosage).
 */
const INTENTIONAL =
  /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$|^https?:\/\/|^(Twilio|Paymob|CBCT|IP:|500mg|AB[+-]?)$|^(admin@|info@|contact@|clinic@|doctor@|staff@|claims@|test@|patient@)/

function acceptable(text: string, translated: string): boolean {
  if (/[\u0600-\u06FF]/.test(translated)) return true // localized
  if (text in dictionaries['ar-EG']) return true // dictionary key by design
  return INTENTIONAL.test(text.trim())
}

describe('Issue 6 sweep — t() call sites resolve to Arabic', () => {
  it('resolves every t()-wrapped ASCII literal in app/ and components/ (technical tokens whitelisted)', () => {
    const offenders: string[] = []
    let audited = 0
    for (const dir of ['app', 'components']) {
      for (const file of walk(dir)) {
        const src = fs.readFileSync(file, 'utf8')
        for (const m of src.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
          const raw = m[2]
          if (!raw || !/[A-Za-z]{2}/.test(raw)) continue
          if (!/^[\x20-\x7F]*$/.test(raw)) continue // Arabic literals pass through by design
          audited++
          const text = decodeJs(raw)
          if (TECHNICAL.test(text)) continue
          if (!acceptable(text, translateText('ar-EG', text))) {
            offenders.push(`${file}: ${text}`)
          }
        }
      }
    }
    // non-vacuity: the sweep covers the real call-site population
    expect(audited).toBeGreaterThan(4000)
    expect(offenders).toEqual([])
  })

  it('carries the Issue-6 dictionary additions in both locales (parity)', () => {
    const additions = ['ui.password', 'Allergies: {v1}', ' (age {v1})', 'Failed to update cost']
    for (const key of additions) {
      expect(dictionaries['en-US'][key]).toBeTruthy()
      expect(dictionaries['ar-EG'][key]).toMatch(/[\u0600-\u06FF]/)
    }
    expect(dictionaries['ar-EG']['ui.password']).toBe('كلمة المرور')
    expect(dictionaries['ar-EG']['Allergies: {v1}']).toBe('الحساسية: {v1}')
  })

  it('patient-facing prescription PDF strings render Arabic (allergies + age line)', () => {
    expect(translateText('ar-EG', 'Allergies: {v1}', { v1: 'بنسلين' })).toBe('الحساسية: بنسلين')
    expect(translateText('ar-EG', ' (age {v1})', { v1: 35 })).toBe(' (35 سنة)')
    // and the routes really use them
    const pdfRoute = fs.readFileSync('app/api/documents/prescription/[id]/route.ts', 'utf8')
    expect(pdfRoute).toContain("t('Allergies: {v1}'")
    expect(pdfRoute).toContain("t(' (age {v1})'")
    const portalPdf = fs.readFileSync('app/api/patient-portal/prescriptions/[id]/pdf/route.ts', 'utf8')
    expect(portalPdf).toContain("t(' (age {v1})'")
  })
})

describe('Issue 6 sweep — API permission messages are Arabic at source', () => {
  it('no English "You don\'t have permission …" remains anywhere in app/api', () => {
    const offenders: string[] = []
    for (const file of walk('app/api')) {
      const src = fs.readFileSync(file, 'utf8')
      if (/You don.t have permission to/.test(src)) offenders.push(file)
    }
    expect(offenders).toEqual([])
    // spot-check the canonical Arabic denials (H6)
    expect(translateText('ar-EG', 'لا تملك صلاحية إنشاء الفواتير')).toMatch(/[\u0600-\u06FF]/)
    const invoices = fs.readFileSync('app/api/invoices/route.ts', 'utf8')
    expect(invoices).toContain('لا تملك صلاحية إنشاء الفواتير')
    const treatments = fs.readFileSync('app/api/treatments/[id]/route.ts', 'utf8')
    expect(treatments).toContain('لا تملك صلاحية تعديل جلسات العلاج')
  })
})

describe('Issue 6 sweep — server-rendered patient/staff surfaces', () => {
  it('system emails (invite + verify) are Arabic RTL with no English prose', () => {
    const src = fs.readFileSync('lib/email-helpers.ts', 'utf8')
    expect(src).toContain('<html lang="ar" dir="rtl">')
    expect(src).toContain('قبول الدعوة')
    expect(src).toContain('تأكيد البريد الإلكتروني')
    expect(src).toContain('دعوة للانضمام')
    expect(src).not.toMatch(/You're invited|Accept Invitation|Verify your email address|This link expires/)
    // canonical Arabic role names in invite emails
    expect(src).toContain("DOCTOR: 'طبيب'")
    expect(src).toContain("RECEPTIONIST: 'موظف استقبال'")
  })

  it('the review-request SMS body is Arabic', () => {
    const src = fs.readFileSync('lib/services/communication-triggers.service.ts', 'utf8')
    expect(src).toContain('شكرًا لزيارتك')
    expect(src).not.toContain('thank you for visiting')
    expect(src).not.toContain('Our Dental Clinic')
  })

  it('the super-admin chrome is Arabic (product name retained)', () => {
    const src = fs.readFileSync('app/super-admin/layout.tsx', 'utf8')
    expect(src).toContain('المشرف الأعلى')
    expect(src).toContain('لوحة تحكم DenToRa')
    expect(src).not.toContain('Super Admin')
    expect(src).not.toContain('Control Panel')
  })
})

describe('Issue 6 sweep — inline error slots localize at render', () => {
  it('every raw {error} state slot renders through t()', () => {
    // These pages store a message (API error or caught exception) in state and
    // render it inline — the one surface the central toast localizer cannot
    // reach. The sweep wrapped them; this pins them.
    const pages = [
      'app/(dashboard)/appointments/[id]/edit/page.tsx',
      'app/(dashboard)/appointments/new/page.tsx',
      'app/(dashboard)/billing/invoices/[id]/page.tsx',
      'app/(dashboard)/billing/invoices/new/page.tsx',
      'app/(dashboard)/billing/page.tsx',
      'app/(dashboard)/settings/procedures/page.tsx',
      'app/(dashboard)/treatments/new/page.tsx',
      'app/(dashboard)/treatments/plans/new/page.tsx',
      'app/portal/(secure)/upload-photo/page.tsx',
    ]
    for (const p of pages) {
      const src = fs.readFileSync(p, 'utf8')
      expect(src, p).toContain('{t(error)}')
      expect(src, p).not.toMatch(/\{error\}/)
    }
    const video = fs.readFileSync('app/portal/(secure)/video/[id]/page.tsx', 'utf8')
    expect(video).toContain("{error ? t(error) : t('Consultation not found')}")
  })
})
