import { describe, it, expect } from 'vitest'

import { jpegInfo, renderSimplePdf } from '@/lib/pdf'

// Phase 20 (D9) — the imaging report embeds the original X-ray into the
// existing text PDF writer. These tests pin the contract:
//
//   1. A document WITHOUT an image renders byte-identically to the
//      pre-Phase-20 writer (existing prescription/invoice PDFs must not
//      change one byte).
//   2. A document WITH an image gains a DCTDecode XObject and valid PDF
//      structure, with the colour space taken from the JPEG header itself.
//
// The JPEG fixtures are real (minimal 1x1) JPEGs so SOF parsing is tested
// against actual marker bytes, not fakes.

// 1x1 RGB (red) JPEG.
const RGB_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIAAEAAQMBEQACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/APxfr/Kc/wC/g//Z',
  'base64'
)
const BASE = {
  title: 'DenToRa Dental Clinic',
  subtitle: 'Imaging report',
  lines: [
    { text: 'Patient: Amina Ali' },
    { text: 'التسوس متوسط الدرجة في السن السادس' },
    { text: 'Finding: Caries — 94%' },
    { text: 'Reviewed by: Dr. Ahmed — 2026-09-27', bold: true },
  ],
  footer: 'This report has been reviewed by a specialist doctor',
}

// Minimal SOI + SOF0 marker with a single component (grayscale). Encoders
// like jimp emit YCbCr for "greyscale" images, so a synthetic SOF is used to
// pin the 1-component branch of the colour-space routing precisely.
const GRAY_SOF = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01])

describe('jpegInfo', () => {
  it('reads SOF dimensions and component count from a real JPEG', () => {
    expect(jpegInfo(RGB_JPEG)).toEqual({ width: 1, height: 1, components: 3 })
  })

  it('detects a 1-component (grayscale) SOF', () => {
    expect(jpegInfo(GRAY_SOF)).toEqual({ width: 1, height: 1, components: 1 })
  })

  it('rejects non-JPEG buffers', () => {
    expect(jpegInfo(Buffer.from('not a jpeg at all'))).toBeNull()
    expect(jpegInfo(Buffer.alloc(0))).toBeNull()
  })
})

describe('renderSimplePdf — image option (Phase 20)', () => {
  it('embeds a JPEG as a DCTDecode XObject with a valid PDF envelope', () => {
    const pdf = renderSimplePdf({ ...BASE, image: { data: RGB_JPEG, width: 1, height: 1 } })

    expect(pdf.slice(0, 5).toString()).toBe('%PDF-')
    expect(pdf.slice(-5).toString()).toBe('%%EOF')
    expect(pdf.toString('latin1')).toContain('/Filter /DCTDecode')
    expect(pdf.toString('latin1')).toContain('/Subtype /Image')
    expect(pdf.toString('latin1')).toContain('/XObject << /Im0 5 0 R >>')
    // The raw JPEG bytes are embedded verbatim (DCTDecode contract).
    expect(pdf.includes(RGB_JPEG)).toBe(true)
  })

  it('derives the colour space from the JPEG header (gray vs RGB)', () => {
    const grayPdf = renderSimplePdf({ ...BASE, image: { data: GRAY_SOF, width: 1, height: 1 } })
    expect(grayPdf.toString('latin1')).toContain('/DeviceGray')
    expect(grayPdf.toString('latin1')).not.toContain('/DeviceRGB')

    const rgbPdf = renderSimplePdf({ ...BASE, image: { data: RGB_JPEG, width: 1, height: 1 } })
    expect(rgbPdf.toString('latin1')).toContain('/DeviceRGB')
  })

  it('keeps text-only documents byte-identical to the pre-Phase-20 writer', async () => {
    // The committed implementation, for the no-image path only.
    const { execSync } = await import('child_process')
    const { writeFileSync, unlinkSync, existsSync } = await import('fs')
    const { join } = await import('path')

    const tmpPath = join(process.cwd(), 'lib/__pdf_old_tmp__.ts')
    const oldSource = execSync('git show HEAD:lib/pdf.ts', {
      cwd: process.cwd(),
      encoding: 'utf-8',
    })
    // The old file imports ./pdf-font & ./pdf-arabic relative to lib/ — place
    // the copy inside lib/ so resolution matches.
    writeFileSync(tmpPath, oldSource)
    try {
      // Runtime specifier (not statically resolvable at transform time — the
      // file only exists while this test runs).
      const specifier = '../../lib/__pdf_old_tmp__'
      const oldModule = await import(/* @vite-ignore */ specifier)
      const oldOut = oldModule.renderSimplePdf(BASE)
      const newOut = renderSimplePdf(BASE)
      expect(Buffer.compare(oldOut, newOut)).toBe(0)
    } finally {
      if (existsSync(tmpPath)) unlinkSync(tmpPath)
    }
  })

  it('text-only output keeps the legacy object numbering (no XObject)', () => {
    const pdf = renderSimplePdf(BASE)
    const text = pdf.toString('latin1')
    expect(text).toContain('/F1 5 0 R /F2 6 0 R')
    expect(text).not.toContain('/XObject')
    expect(text).not.toContain('/DCTDecode')
  })
})
