/**
 * Minimal dependency-free PDF writer for messaging attachments
 * (prescriptions, invoices).
 *
 * Two rendering paths share one layout engine:
 *
 *  - Latin-only documents use the core Helvetica fonts, as before — no font
 *    data is embedded, so an English attachment stays a few KB.
 *  - Documents containing Arabic (or any non-Latin-1 text) embed a subset of
 *    Noto Naskh Arabic as a CID font with Identity-H encoding. The text is
 *    shaped and reordered by `lib/pdf-arabic.ts`, and a ToUnicode map is
 *    written alongside it so the Arabic stays copy-pasteable.
 *
 * Before the embedded path existed, Arabic names and diagnoses were written
 * as `?????` because core PDF fonts cannot represent them at all.
 */
import { subsetFontFor, fontStream, type EmbeddedFont } from './pdf-font'
import {
  needsEmbeddedFont,
  orderText,
  shapeArabicClusters,
  type ShapedGlyphCluster,
} from './pdf-arabic'

interface PdfLine {
  text: string
  size?: number
  bold?: boolean
  gapAfter?: number
}

interface SimplePdfInput {
  title: string
  subtitle?: string
  lines: PdfLine[]
  footer?: string
  /**
   * Optional embedded raster image (JPEG only — DCTDecode, no re-encoding).
   * Drawn below the title block, scaled to fit the text width. Documents
   * without an image render byte-identically to before this option existed.
   */
  image?: PdfImageInput
}

interface PdfImageInput {
  /** Raw JPEG bytes. */
  data: Buffer
  /** Pixel dimensions (must match the JPEG header). */
  width: number
  height: number
}

/**
 * Read the first SOF (start-of-frame) marker of a JPEG stream.
 * Returns width/height and the component count (1 = grayscale, 3 = RGB).
 * Returns `null` when the buffer is not a JPEG we can parse.
 */
export function jpegInfo(
  data: Buffer
): { width: number; height: number; components: number } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null
  for (let i = 2; i + 10 < data.length; i++) {
    if (data[i] !== 0xff) continue
    const marker = data[i + 1]
    // SOF0–SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: data.readUInt16BE(i + 5),
        width: data.readUInt16BE(i + 7),
        components: data[i + 9],
      }
    }
  }
  return null
}

/** Escape PDF literal-string specials. */
function escapePdfText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    // WinAnsi-safe: drop anything outside Latin-1 to keep encoding valid.
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?')
}

interface PreparedLine {
  text: string
  size: number
  bold: boolean
  gapAfter: number
  /** Visual-order clusters, present when the line uses the embedded font. */
  clusters?: ShapedGlyphCluster[]
  /** Paragraph direction, for alignment. */
  rtl?: boolean
}

function prepare(text: string, size: number, bold: boolean, gapAfter: number): PreparedLine {
  if (!needsEmbeddedFont(text)) return { text, size, bold, gapAfter }
  const { visual, rtl } = orderText(shapeArabicClusters(text))
  return { text, size, bold, gapAfter, clusters: visual, rtl }
}

/** Sum of the advance widths of a cluster run, in text-space units. */
function clustersWidth(
  clusters: ShapedGlyphCluster[],
  font: EmbeddedFont,
  size: number,
  glyphFor: (codePoint: number) => number
): number {
  let total = 0
  for (const cluster of clusters) {
    if (cluster.mark) continue // combining marks do not advance the pen
    total += font.widthOf(glyphFor(cluster.codePoint))
  }
  return (total * size) / font.unitsPerEm
}

function toUnicodeCMap(gidToUnicode: Map<number, string>): string {
  const entries = [...gidToUnicode.entries()].sort((a, b) => a[0] - b[0])
  const toHex = (value: string) => {
    let hex = ''
    for (const char of value) {
      const code = char.codePointAt(0) as number
      if (code > 0xffff) {
        const offset = code - 0x10000
        hex += (0xd800 + (offset >> 10)).toString(16).padStart(4, '0')
        hex += (0xdc00 + (offset & 0x3ff)).toString(16).padStart(4, '0')
      } else {
        hex += code.toString(16).padStart(4, '0')
      }
    }
    return hex.toUpperCase()
  }

  const blocks: string[] = []
  for (let index = 0; index < entries.length; index += 100) {
    const slice = entries.slice(index, index + 100)
    blocks.push(`${slice.length} beginbfchar`)
    for (const [gid, unicode] of slice) {
      blocks.push(`<${gid.toString(16).padStart(4, '0').toUpperCase()}> <${toHex(unicode)}>`)
    }
    blocks.push('endbfchar')
  }

  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n')
}

/**
 * Render a simple one-page A4 PDF. Returns a Buffer that starts with the
 * `%PDF-` magic and ends with `%%EOF`.
 */
export function renderSimplePdf(input: SimplePdfInput): Buffer {
  const pageWidth = 595.28 // A4 pt
  const pageHeight = 841.89
  const leftMargin = 56
  const rightMargin = 56
  let y = pageHeight - 72

  const titleLine = prepare(input.title, 18, true, 0)
  const subtitleLine = input.subtitle ? prepare(input.subtitle, 11, false, 0) : null
  const bodyLines = input.lines.map((line) =>
    prepare(line.text ?? '', line.size ?? 11, line.bold ?? false, line.gapAfter ?? 0)
  )
  const footerLine = input.footer ? prepare(input.footer, 9, false, 0) : null

  const allLines = [titleLine, subtitleLine, ...bodyLines, footerLine].filter(
    (line): line is PreparedLine => !!line
  )
  const usesEmbeddedFont = allLines.some((line) => !!line.clusters)

  const embeddedFont = usesEmbeddedFont
    ? subsetFontFor(
        allLines.flatMap((line) => line.clusters?.map((cluster) => cluster.codePoint) ?? [])
      )
    : null

  // Glyph ids for the embedded path. A character the font does not cover would
  // otherwise be drawn as .notdef (an empty box) in a patient document, so it
  // falls back to "?" — visible, and honest about being unrepresentable.
  const glyphFor = (codePoint: number): number => {
    if (!embeddedFont) return 0
    const gid = embeddedFont.gidFor(codePoint)
    if (gid) return gid
    return embeddedFont.gidFor(0x3f) // '?'
  }

  const gidToUnicode = new Map<number, string>()
  if (embeddedFont) {
    const fallbackGid = embeddedFont.gidFor(0x3f)
    if (fallbackGid) gidToUnicode.set(fallbackGid, '?')
    for (const line of allLines) {
      for (const cluster of line.clusters ?? []) {
        const gid = glyphFor(cluster.codePoint)
        if (gid && !gidToUnicode.has(gid)) gidToUnicode.set(gid, cluster.toUnicode)
      }
    }
  }

  const contentOps: string[] = ['BT']
  const writeLine = (line: PreparedLine) => {
    const { size, bold } = line

    if (line.clusters && embeddedFont) {
      // Embedded CID font: glyph ids are written as a hex string, and the pen
      // is positioned per line so Arabic lines can sit flush right.
      const width = clustersWidth(line.clusters, embeddedFont, size, glyphFor)
      const rtl = line.rtl ?? false
      const x = rtl ? Math.max(leftMargin, pageWidth - rightMargin - width) : leftMargin
      contentOps.push('/CF1 ' + size + ' Tf')
      if (bold) contentOps.push(`2 Tr ${(size * 0.035).toFixed(2)} w`) // faux bold: fill + stroke
      contentOps.push(`1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`)
      const hex = line.clusters
        .map((cluster) => glyphFor(cluster.codePoint).toString(16).padStart(4, '0'))
        .join('')
      contentOps.push(`<${hex}> Tj`)
      if (bold) contentOps.push('0 Tr')
      y -= size * 1.8 // Arabic needs more room for marks and descenders
      return
    }

    const font = bold ? '/F2' : '/F1'
    contentOps.push(`${font} ${size} Tf`)
    contentOps.push(`1 0 0 1 ${leftMargin} ${y.toFixed(2)} Tm`)
    contentOps.push(`(${escapePdfText(line.text)}) Tj`)
    y -= size * 1.5
  }

  writeLine(titleLine)
  if (subtitleLine) {
    writeLine(subtitleLine)
    y -= 6
  }

  // Optional embedded JPEG (Phase 20 imaging report). When present the text
  // block is closed, the image drawn, and a second text block opened — the
  // pen position `y` already accounts for the image height below.
  const image = input.image
  const maxImageWidth = pageWidth - leftMargin - rightMargin
  const maxImageHeight = 240
  let drawImage = false
  if (image) {
    const scale = Math.min(maxImageWidth / image.width, maxImageHeight / image.height)
    const displayWidth = image.width * scale
    const displayHeight = image.height * scale
    // Keep at least the footer zone free; if it cannot fit, drop the image
    // rather than overflowing the single page.
    if (y - displayHeight >= 96) {
      const x = (pageWidth - displayWidth) / 2
      contentOps.push('ET')
      contentOps.push('q')
      contentOps.push(
        `${displayWidth.toFixed(2)} 0 0 ${displayHeight.toFixed(2)} ${x.toFixed(2)} ${(y - displayHeight).toFixed(2)} cm`
      )
      contentOps.push('/Im0 Do')
      contentOps.push('Q')
      contentOps.push('BT')
      y -= displayHeight + 12
      drawImage = true
    }
  }

  y -= 8
  for (const line of bodyLines) {
    if (y < 72) break // single-page guard
    writeLine(line)
    if (line.gapAfter) y -= line.gapAfter
  }
  if (footerLine) {
    y = 56
    writeLine(footerLine)
  }
  contentOps.push('ET')
  const content = contentOps.join('\n')

  const objects: Buffer[] = []
  const push = (value: string | Buffer) => {
    objects.push(typeof value === 'string' ? Buffer.from(value, 'latin1') : value)
  }

  // Object numbering: the image XObject takes slot 5 when present, which
  // pushes every font object one slot higher. Without an image the numbering
  // is exactly the legacy layout (F1=5, F2=6, CF1=7, CIDFont=8, …).
  const f1 = drawImage ? 7 : 5
  const f2 = f1 + 1
  const cf1 = f2 + 1
  const cidFont = cf1 + 1
  const fontDescriptor = cidFont + 1
  const toUnicodeNum = fontDescriptor + 1
  const fontFileNum = toUnicodeNum + 1

  const fontResources = embeddedFont
    ? `/F1 ${f1} 0 R /F2 ${f2} 0 R /CF1 ${cf1} 0 R`
    : `/F1 ${f1} 0 R /F2 ${f2} 0 R`

  push('<< /Type /Catalog /Pages 2 0 R >>')
  push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << ${fontResources} >>${drawImage ? ' /XObject << /Im0 5 0 R >>' : ''} >> /Contents 4 0 R >>`
  )
  push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`)
  if (drawImage && image) {
    // DCTDecode takes the raw JPEG bytes; the colour space follows the
    // number of components in the JPEG header itself.
    const components = jpegInfo(image.data)?.components
    const colorSpace = components === 1 ? 'DeviceGray' : 'DeviceRGB'
    push(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.data.length} >>\nstream\n`,
          'latin1'
        ),
        image.data,
        Buffer.from('\nendstream', 'latin1'),
      ])
    )
  }
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')

  if (embeddedFont) {
    const stream = fontStream(embeddedFont)
    const [x0, y0, x1, y1] = embeddedFont.bbox
    const scale = 1000 / embeddedFont.unitsPerEm
    const bbox = [x0, y0, x1, y1].map((value) => Math.round(value * scale)).join(' ')
    // Glyph widths: a [gid [w] ...] array, in 1000-unit em space.
    const widths = [...gidToUnicode.keys()]
      .sort((a, b) => a - b)
      .map((gid) => `${gid} [${Math.round(embeddedFont.widthOf(gid) * scale)}]`)
      .join(' ')
    const descriptorFlags = 4 | 32 // symbolic + non-symbolic, per common practice

    push(
      `<< /Type /Font /Subtype /Type0 /BaseFont /NotoNaskhArabic /Encoding /Identity-H /DescendantFonts [${cidFont} 0 R] /ToUnicode ${toUnicodeNum} 0 R >>`
    )
    push(
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /NotoNaskhArabic /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fontDescriptor} 0 R /DW 1000 /W [${widths}] /CIDToGIDMap /Identity >>`
    )
    push(
      `<< /Type /FontDescriptor /FontName /NotoNaskhArabic /Flags ${descriptorFlags} /FontBBox [${bbox}] /ItalicAngle 0 /Ascent ${Math.round(embeddedFont.ascent * scale)} /Descent ${Math.round(embeddedFont.descent * scale)} /CapHeight 700 /StemV 80 /FontFile2 ${fontFileNum} 0 R >>`
    )
    const cmap = toUnicodeCMap(gidToUnicode)
    push(`<< /Length ${Buffer.byteLength(cmap, 'latin1')} >>\nstream\n${cmap}\nendstream`)
    push(
      Buffer.concat([
        Buffer.from(
          `<< /Length ${stream.data.length} /Length1 ${stream.length1}${stream.compressed ? ' /Filter /FlateDecode' : ''} >>\nstream\n`,
          'latin1'
        ),
        stream.data,
        Buffer.from('\nendstream', 'latin1'),
      ])
    )
  }

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')]
  let offset = chunks[0].length
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(offset)
    const head = Buffer.from(`${index + 1} 0 obj\n`, 'latin1')
    const tail = Buffer.from('\nendobj\n', 'latin1')
    chunks.push(head, object, tail)
    offset += head.length + object.length + tail.length
  })

  const xrefOffset = offset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const entry of offsets) xref += `${String(entry).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  chunks.push(Buffer.from(xref, 'latin1'))

  return Buffer.concat(chunks)
}
