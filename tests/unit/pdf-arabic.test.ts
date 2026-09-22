// @ts-nocheck
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

import { renderSimplePdf } from '@/lib/pdf'
import { subsetFontFor, fontStream } from '@/lib/pdf-font'
import { needsEmbeddedFont, orderText, shapeArabicClusters } from '@/lib/pdf-arabic'

/**
 * Arabic PDF attachments.
 *
 * Before this existed, patient documents went out with the Arabic as `?????`
 * because core PDF fonts are Latin-1 only. These tests pin the three things
 * that make an Arabic PDF work: contextual shaping, visual reordering, and a
 * font subset that carries the glyphs.
 */

const asLatin1 = (buffer: Buffer) => buffer.toString('latin1')

/** Read the glyph ids a subset actually carries outlines for. */
function nonEmptyGlyphCount(ttf: Buffer): number {
  const tableCount = ttf.readUInt16BE(4)
  const tables: Record<string, { offset: number }> = {}
  for (let i = 0; i < tableCount; i++) {
    const record = 12 + i * 16
    tables[ttf.toString('latin1', record, record + 4)] = { offset: ttf.readUInt32BE(record + 8) }
  }
  const numGlyphs = ttf.readUInt16BE(tables.maxp.offset + 4)
  let count = 0
  for (let gid = 0; gid < numGlyphs; gid++) {
    const start = ttf.readUInt32BE(tables.loca.offset + gid * 4)
    const end = ttf.readUInt32BE(tables.loca.offset + (gid + 1) * 4)
    if (end > start) count++
  }
  return count
}

describe('Arabic shaping', () => {
  const forms = (text: string) =>
    shapeArabicClusters(text).map((cluster) => cluster.codePoint.toString(16).toUpperCase())

  it('joins letters into the right contextual presentation forms', () => {
    // محمد — meem(initial) hah(medial) meem(medial) dal(final)
    expect(forms('محمد')).toEqual(['FEE3', 'FEA4', 'FEE4', 'FEAA'])
    // حساب — hah(initial) seen(medial) alef(final) beh(isolated, after alef)
    expect(forms('حساب')).toEqual(['FEA3', 'FEB4', 'FE8E', 'FE8F'])
    // final-form yeh only when something precedes that can join
    expect(forms('في')).toEqual(['FED3', 'FEF2'])
    const isolated = shapeArabicClusters('و')[0]
    expect(isolated.codePoint).toBe(0xFEED) // waw never joins forward
  })

  it('keeps lam and alef as separate glyphs so the text layer stays exact', () => {
    // A ligature would be one glyph for two characters, and extractors reverse
    // RTL runs per character — turning بلال into بالل. Two glyphs, exact text.
    const shaped = shapeArabicClusters('بلال')
    expect(shaped).toHaveLength(4)
    expect(shaped.map((c) => c.toUnicode).join('')).toBe('بلال')
    // beh(initial) lam(medial — it links beh to alef) alef(final)
    // lam(isolated — alef never joins forward, so nothing links to it).
    expect(shaped.map((c) => c.codePoint.toString(16).toUpperCase())).toEqual([
      'FE91', 'FEE0', 'FE8E', 'FEDD',
    ])
  })

  it('drops bidi control characters, which the font cannot draw', () => {
    // Intl wraps ar-EG currency output in U+200F; it would render as .notdef.
    const shaped = shapeArabicClusters('ج.م\u200f ١٢\u200f')
    expect(shaped.some((c) => c.codePoint === 0x200f)).toBe(false)
  })
})

describe('Arabic visual ordering', () => {
  const visual = (text: string) => orderText(shapeArabicClusters(text))
  const asText = (text: string) => visual(text).visual.map((c) => c.toUnicode).join('')

  it('places right-to-left text so the last logical glyph is leftmost', () => {
    expect(asText('أب')).toBe('بأ')
  })

  it('keeps Latin tokens and numbers intact and in the right order', () => {
    const ordered = visual('فاتورة INV-1001')
    expect(ordered.rtl).toBe(true)
    // The Latin token survives whole (hyphen-separated runs are merged)...
    expect(asText('فاتورة INV-1001')).toBe('INV-1001 ةروتاف')
    // ...and because the line starts with Arabic it aligns right.
    expect(ordered.rtl).toBe(true)
  })

  it('does not merge a Latin number with an Arabic-Indic one', () => {
    // Unicode rule N1: digits of different classes are not one run, so the
    // dash between 2 and ٨٠٠ keeps the paragraph direction — which is why the
    // two numbers stay in logical order instead of swapping.
    expect(asText('- حشو × 2 — ٨٠٠ ج.م')).toBe('م.ج ٨٠٠ — 2 × وشح -')
  })

  it('mirrors bracket pairs inside right-to-left text', () => {
    // The logical '(' ends up on the right of the visual line and is drawn as
    // its mirror image, so the pair still faces inwards.
    expect(asText('فاتورة (تجريبية)')).toBe('(ةيبيرجت) ةروتاف')
    expect(asText('فاتورة (تجريبية)').startsWith('(')).toBe(true)
  })
})

describe('embedded font subset', () => {
  it('ships the font asset with its licence', () => {
    const font = readFileSync(join(process.cwd(), 'assets/fonts/NotoNaskhArabic-Regular.ttf'))
    expect(font.length).toBeGreaterThan(50_000)
    const licence = readFileSync(join(process.cwd(), 'assets/fonts/NotoNaskhArabic-LICENSE.txt'), 'utf8')
    expect(licence).toContain('SIL OPEN FONT LICENSE')
  })

  it('maps every presentation form and the Arabic letters to real glyphs', () => {
    const subset = subsetFontFor([...'فاتورة المريض أحمد محمود ١٢٥٠'].map((c) => c.codePointAt(0) as number))
    for (const codePoint of [0xfe8d, 0xfee0, 0xfed3, 0xfef4, 0x0661]) {
      expect(subset.gidFor(codePoint), codePoint.toString(16)).toBeGreaterThan(0)
    }
    expect(subset.unitsPerEm).toBe(1000)
  })

  it('keeps default glyph ids while shrinking the file', () => {
    const text = 'فاتورة المريض أحمد محمود ١٢٥٠ ج.م'
    const subset = subsetFontFor([...text].map((c) => c.codePointAt(0) as number))
    const source = readFileSync(join(process.cwd(), 'assets/fonts/NotoNaskhArabic-Regular.ttf'))
    expect(subset.ttf.length).toBeLessThan(source.length / 10)
    expect(subset.ttf.readUInt32BE(0)).toBe(0x00010000)
    // The subset has outlines for the glyphs it was built for — not just an
    // empty skeleton with valid headers.
    expect(nonEmptyGlyphCount(subset.ttf)).toBeGreaterThan(20)
    // FontFile2 streams need the uncompressed length alongside the data.
    const stream = fontStream(subset)
    expect(stream.length1).toBe(subset.ttf.length)
    expect(stream.data.length).toBeLessThan(subset.ttf.length)
  })
})

describe('PDF writer — embedded font path', () => {
  const arabic = renderSimplePdf({
    title: 'فاتورة INV-1001',
    subtitle: 'عيادة دنتورا',
    lines: [{ text: 'المريض: أحمد محمود', bold: true }, { text: 'الإجمالي: ١٢٥٠ ج.م' }],
    footer: 'شكرًا لاختيارك عيادتنا.',
  })

  it('embeds a Type0 CID font with a ToUnicode map when Arabic is present', () => {
    const text = asLatin1(arabic)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(text).toContain('/Subtype /Type0')
    expect(text).toContain('/Encoding /Identity-H')
    expect(text).toContain('/FontFile2')
    expect(text).toContain('/ToUnicode')
    expect(text).toContain('beginbfchar')
  })

  it('no longer writes question marks where Arabic should be', () => {
    // The old failure mode: every Arabic character became "?".
    expect(asLatin1(arabic)).not.toMatch(/\(\?\?\?/)
    expect(asLatin1(arabic)).not.toContain('?????')
  })

  it('keeps Latin-only documents on core fonts (no font data embedded)', () => {
    const latin = renderSimplePdf({ title: 'Invoice INV-1001', lines: [{ text: 'Total: EGP 1,600' }] })
    const text = asLatin1(latin)
    expect(text).toContain('/BaseFont /Helvetica')
    expect(text).not.toContain('/FontFile2')
    expect(latin.length).toBeLessThan(arabic.length)
  })

  it('extracts back to the exact logical Arabic it was given', async () => {
    // Round-trip through a real PDF parser: glyphs -> ToUnicode -> text.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({ data: new Uint8Array(arabic), isEvalSupported: false }).promise
    const page = await doc.getPage(1)
    const content = await page.getTextContent()
    const lines = content.items.map((item: { str: string }) => item.str)
    expect(lines).toContain('فاتورة INV-1001')
    expect(lines).toContain('المريض: أحمد محمود')
    expect(lines).toContain('الإجمالي: ١٢٥٠ ج.م')
    expect(lines).toContain('شكرًا لاختيارك عيادتنا.')
  })
})

describe('embedded-font detection', () => {
  it('only routes text the core fonts cannot draw to the embedded font', () => {
    expect(needsEmbeddedFont('EGP 1,600.00')).toBe(false)
    expect(needsEmbeddedFont('Café naïve résumé')).toBe(false)
    expect(needsEmbeddedFont('ج.م ١٢٠٠')).toBe(true)
    expect(needsEmbeddedFont('Patient: أحمد')).toBe(true)
  })

  it('routes typographic characters the core fonts would mangle', () => {
    // WinAnsi-only characters such as the em dash used in invoice subtitles
    // are outside Latin-1; `escapePdfText` would turn them into "?", so they
    // go to the embedded font — which the asset covers.
    expect(needsEmbeddedFont('Clinic — 2026-09-22')).toBe(true)
    const subset = subsetFontFor([0x2014, 0x2013, 0x2022, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x00d7])
    for (const codePoint of [0x2014, 0x2013, 0x2022, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x00d7]) {
      expect(subset.gidFor(codePoint), codePoint.toString(16)).toBeGreaterThan(0)
    }
  })
})
