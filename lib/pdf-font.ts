/**
 * TrueType subsetting + metrics for the embedded PDF font.
 *
 * Why this exists: PDF's core fonts (Helvetica and friends) are Latin-1 only,
 * so Arabic names, item descriptions and diagnoses were being written into
 * patient documents as `?????`. Rendering them needs a real Arabic font,
 * embedded as a CID font with Identity-H encoding.
 *
 * Embedding the whole font would add ~200 KB to every WhatsApp attachment, so
 * this module writes a subset. It deliberately keeps the ORIGINAL glyph ids
 * (unused glyphs become empty, `loca` stays indexable) — that way the cmap,
 * composite-glyph component references and the Identity-H CID mapping all stay
 * valid without renumbering anything.
 *
 * Only the tables an embedded subset needs are written out; layout tables
 * (GSUB/GPOS/GDEF/kern) are dropped because the Arabic shaping in
 * `lib/pdf-arabic.ts` selects joined presentation forms itself.
 */
import { readFileSync } from 'fs'
import { deflateSync } from 'zlib'
import path from 'path'

const FONT_RELATIVE_PATH = 'assets/fonts/NotoNaskhArabic-Regular.ttf'

/** SFNT table directory entry. */
interface TableRecord {
  offset: number
  length: number
}

interface ParsedFont {
  buffer: Buffer
  tables: Record<string, TableRecord>
  numGlyphs: number
  unitsPerEm: number
  bbox: [number, number, number, number]
  ascent: number
  descent: number
  indexToLocFormat: number
}

export interface EmbeddedFont {
  /** The subset sfnt, ready to embed as a /FontFile2 stream. */
  ttf: Buffer
  /** Original glyph id for a Unicode code point (0 = .notdef). */
  gidFor(codePoint: number): number
  /** Advance width in 1000-unit em space. */
  widthOf(gid: number): number
  unitsPerEm: number
  bbox: [number, number, number, number]
  ascent: number
  descent: number
}

function readTables(buffer: Buffer): Record<string, TableRecord> {
  const tableCount = buffer.readUInt16BE(4)
  const tables: Record<string, TableRecord> = {}
  for (let i = 0; i < tableCount; i++) {
    const record = 12 + i * 16
    const tag = buffer.toString('latin1', record, record + 4)
    tables[tag] = {
      offset: buffer.readUInt32BE(record + 8),
      length: buffer.readUInt32BE(record + 12),
    }
  }
  return tables
}

/** Build a `code point -> glyph id` function from the font's cmap. */
function cmapLookup(font: ParsedFont): (codePoint: number) => number {
  const buffer = font.buffer
  const cmap = font.tables.cmap
  if (!cmap) return () => 0

  const recordCount = buffer.readUInt16BE(cmap.offset + 2)
  let best: { base: number; format: number } | null = null
  for (let i = 0; i < recordCount; i++) {
    const record = cmap.offset + 4 + i * 8
    const platformId = buffer.readUInt16BE(record)
    const encodingId = buffer.readUInt16BE(record + 2)
    const subtable = cmap.offset + buffer.readUInt32BE(record + 4)
    // Prefer the full-repertoire Unicode subtables (3/10 then 3/1).
    if (platformId === 3 && (encodingId === 1 || encodingId === 10)) {
      best = { base: subtable, format: buffer.readUInt16BE(subtable) }
    } else if (platformId === 0 && !best) {
      best = { base: subtable, format: buffer.readUInt16BE(subtable) }
    }
  }
  if (!best) return () => 0

  if (best.format === 12) {
    const groupCount = buffer.readUInt32BE(best.base + 12)
    const groups: Array<[number, number, number]> = []
    for (let i = 0; i < groupCount; i++) {
      const record = best.base + 16 + i * 12
      groups.push([
        buffer.readUInt32BE(record),
        buffer.readUInt32BE(record + 4),
        buffer.readUInt32BE(record + 8),
      ])
    }
    return (codePoint: number) => {
      for (const [start, end, startGlyph] of groups) {
        if (codePoint >= start && codePoint <= end) return startGlyph + (codePoint - start)
      }
      return 0
    }
  }

  if (best.format === 4) {
    const segCountX2 = buffer.readUInt16BE(best.base + 6)
    return (codePoint: number) => {
      for (let segment = 0; segment < segCountX2 / 2; segment++) {
        const end = buffer.readUInt16BE(best.base + 14 + segment * 2)
        const start = buffer.readUInt16BE(best.base + 16 + segCountX2 + segment * 2)
        if (codePoint < start || codePoint > end) continue
        const delta = buffer.readInt16BE(best.base + 16 + segCountX2 * 2 + segment * 2)
        const rangeOffsetPos = best.base + 16 + segCountX2 * 3 + segment * 2
        const rangeOffset = buffer.readUInt16BE(rangeOffsetPos)
        if (rangeOffset === 0) return (codePoint + delta) & 0xffff
        const glyphOffset = rangeOffsetPos + rangeOffset + (codePoint - start) * 2
        const glyph = buffer.readUInt16BE(glyphOffset)
        return glyph === 0 ? 0 : (glyph + delta) & 0xffff
      }
      return 0
    }
  }

  return () => 0
}

function parseFont(buffer: Buffer): ParsedFont {
  const tables = readTables(buffer)
  const head = tables.head
  const hhea = tables.hhea
  const maxp = tables.maxp
  return {
    buffer,
    tables,
    numGlyphs: buffer.readUInt16BE(maxp.offset + 4),
    unitsPerEm: buffer.readUInt16BE(head.offset + 18),
    bbox: [
      buffer.readInt16BE(head.offset + 36),
      buffer.readInt16BE(head.offset + 38),
      buffer.readInt16BE(head.offset + 40),
      buffer.readInt16BE(head.offset + 42),
    ],
    ascent: buffer.readInt16BE(hhea.offset + 4),
    descent: buffer.readInt16BE(hhea.offset + 6),
    indexToLocFormat: buffer.readInt16BE(head.offset + 50),
  }
}

/** Byte range of one glyph in `glyf`, via `loca`. */
function glyphRange(font: ParsedFont, gid: number): [number, number] | null {
  const loca = font.tables.loca
  const glyf = font.tables.glyf
  if (!loca || !glyf || gid < 0 || gid >= font.numGlyphs) return null
  const shortFormat = font.indexToLocFormat === 0
  const read = (index: number) =>
    shortFormat ? font.buffer.readUInt16BE(loca.offset + index * 2) * 2 : font.buffer.readUInt32BE(loca.offset + index * 4)
  const start = read(gid)
  const end = read(gid + 1)
  if (end <= start) return null
  return [glyf.offset + start, glyf.offset + end]
}

/** Glyph ids referenced by a composite glyph; empty for simple glyphs. */
function compositeComponents(font: ParsedFont, gid: number): number[] {
  const range = glyphRange(font, gid)
  if (!range) return []
  const [start, end] = range
  if (font.buffer.readInt16BE(start) >= 0) return [] // simple glyph
  const components: number[] = []
  let cursor = start + 10
  while (cursor + 4 <= end) {
    const flags = font.buffer.readUInt16BE(cursor)
    const glyphIndex = font.buffer.readUInt16BE(cursor + 2)
    components.push(glyphIndex)
    cursor += 4
    cursor += flags & 0x0001 ? 4 : 2 // ARG_1_AND_2_ARE_WORDS
    if (flags & 0x0008) cursor += 2 // WE_HAVE_A_SCALE
    else if (flags & 0x0040) cursor += 4 // WE_HAVE_AN_X_AND_Y_SCALE
    else if (flags & 0x0080) cursor += 8 // WE_HAVE_A_TWO_BY_TWO
    if (!(flags & 0x0020)) break // MORE_COMPONENTS
  }
  return components
}

function checksum(buffer: Buffer): number {
  let sum = 0
  for (let i = 0; i < buffer.length; i += 4) {
    const word =
      ((buffer[i] ?? 0) << 24) |
      ((buffer[i + 1] ?? 0) << 16) |
      ((buffer[i + 2] ?? 0) << 8) |
      (buffer[i + 3] ?? 0)
    sum = (sum + (word >>> 0)) >>> 0
  }
  return sum >>> 0
}

function pad4(buffer: Buffer): Buffer {
  const remainder = buffer.length % 4
  if (remainder === 0) return buffer
  return Buffer.concat([buffer, Buffer.alloc(4 - remainder)])
}

let cachedSource: ParsedFont | null = null

function sourceFont(): ParsedFont {
  if (cachedSource) return cachedSource
  const fontPath = path.join(process.cwd(), FONT_RELATIVE_PATH)
  let data: Buffer
  try {
    data = readFileSync(fontPath)
  } catch {
    // Standalone/production deployments must ship the font — see
    // `outputFileTracingIncludes` in next.config.js. Fail loudly rather than
    // silently emitting documents with the text missing.
    throw new Error(
      `Embedded PDF font is missing at ${fontPath}. Ship assets/fonts with the ` +
        `deployment (outputFileTracingIncludes in next.config.js).`
    )
  }
  cachedSource = parseFont(data)
  return cachedSource
}

/**
 * Build a subset containing `codePoints`, keeping the original glyph ids.
 * The returned metrics are in the font's 1000-unit em space.
 */
export function subsetFontFor(codePoints: Iterable<number>): EmbeddedFont {
  const font = sourceFont()
  const lookup = cmapLookup(font)

  const used = new Set<number>([0]) // .notdef always present
  for (const codePoint of codePoints) {
    const gid = lookup(codePoint)
    if (gid) used.add(gid)
  }
  // Composite glyphs reference component glyphs that must ship with them.
  const pending = [...used]
  while (pending.length) {
    const gid = pending.pop() as number
    for (const component of compositeComponents(font, gid)) {
      if (!used.has(component)) {
        used.add(component)
        pending.push(component)
      }
    }
  }

  const numGlyphs = Math.max(...used) + 1
  const glyphBuffers: Buffer[] = []
  const offsets: number[] = [0]
  let glyfLength = 0
  for (let gid = 0; gid < numGlyphs; gid++) {
    const range = used.has(gid) ? glyphRange(font, gid) : null
    const glyph = range ? font.buffer.subarray(range[0], range[1]) : Buffer.alloc(0)
    const padded = pad4(glyph)
    glyphBuffers.push(padded)
    glyfLength += padded.length
    offsets.push(glyfLength)
  }
  const glyf = Buffer.concat(glyphBuffers, glyfLength)

  // loca — long format so offsets can be arbitrary.
  const loca = Buffer.alloc((numGlyphs + 1) * 4)
  offsets.forEach((offset, index) => loca.writeUInt32BE(offset, index * 4))

  // hmtx — one (advance, lsb) pair per glyph; matching hhea.numberOfHMetrics.
  const hmtxSource = font.tables.hmtx
  const originalMetricsCount = font.buffer.readUInt16BE(font.tables.hhea.offset + 34)
  const hmtx = Buffer.alloc(numGlyphs * 4)
  let lastAdvance = 0
  for (let gid = 0; gid < numGlyphs; gid++) {
    if (gid < originalMetricsCount) {
      const advance = font.buffer.readUInt16BE(hmtxSource.offset + gid * 4)
      const lsb = font.buffer.readInt16BE(hmtxSource.offset + gid * 4 + 2)
      hmtx.writeUInt16BE(advance, gid * 4)
      hmtx.writeInt16BE(lsb, gid * 4 + 2)
      lastAdvance = advance
    } else {
      // Monospaced tail: metrics for glyph ids beyond numberOfHMetrics are
      // implied by the last entry, so lsb still has to be read.
      const lsb = font.buffer.readInt16BE(hmtxSource.offset + originalMetricsCount * 4 + (gid - originalMetricsCount) * 2)
      hmtx.writeUInt16BE(lastAdvance, gid * 4)
      hmtx.writeInt16BE(lsb, gid * 4 + 2)
    }
  }

  // head — copy, then fix the fields the rebuild invalidates.
  const head = Buffer.from(font.buffer.subarray(font.tables.head.offset, font.tables.head.offset + font.tables.head.length))
  head.writeInt32BE(0, 8) // checkSumAdjustment, recomputed after assembly
  head.writeInt16BE(1, 50) // indexToLocFormat: long, matching loca above

  const hhea = Buffer.from(font.buffer.subarray(font.tables.hhea.offset, font.tables.hhea.offset + font.tables.hhea.length))
  hhea.writeUInt16BE(numGlyphs, 34) // numberOfHMetrics

  const maxp = Buffer.from(font.buffer.subarray(font.tables.maxp.offset, font.tables.maxp.offset + font.tables.maxp.length))
  maxp.writeUInt16BE(numGlyphs, 4)

  const os2 = font.tables['OS/2']
    ? Buffer.from(font.buffer.subarray(font.tables['OS/2'].offset, font.tables['OS/2'].offset + font.tables['OS/2'].length))
    : null

  // name — a minimal, valid table (family/subfamily/full/postscript).
  const nameStrings: Array<[number, string]> = [
    [1, 'Noto Naskh Arabic'],
    [2, 'Regular'],
    [4, 'Noto Naskh Arabic Regular'],
    [6, 'NotoNaskhArabic-Regular'],
  ]
  const encoded = nameStrings.map(([, value]) => {
    const bytes = Buffer.alloc(value.length * 2)
    for (let i = 0; i < value.length; i++) bytes.writeUInt16BE(value.charCodeAt(i), i * 2)
    return bytes
  })
  const nameHeader = Buffer.alloc(6 + nameStrings.length * 12)
  nameHeader.writeUInt16BE(0, 0) // format
  nameHeader.writeUInt16BE(nameStrings.length, 2)
  nameHeader.writeUInt16BE(6 + nameStrings.length * 12, 4) // stringOffset
  let nameStringOffset = 0
  nameStrings.forEach(([nameId], index) => {
    const record = 6 + index * 12
    nameHeader.writeUInt16BE(3, record) // platformID: Windows
    nameHeader.writeUInt16BE(1, record + 2) // encodingID: Unicode BMP
    nameHeader.writeUInt16BE(0x0409, record + 4) // languageID: en-US
    nameHeader.writeUInt16BE(nameId, record + 6)
    nameHeader.writeUInt16BE(encoded[index].length, record + 8)
    nameHeader.writeUInt16BE(nameStringOffset, record + 10)
    nameStringOffset += encoded[index].length
  })
  const name = Buffer.concat([nameHeader, ...encoded])

  // post — version 3.0 (no glyph names), which is all a subset needs.
  const post = Buffer.alloc(32)
  post.writeUInt32BE(0x00030000, 0)

  const tables: Array<[string, Buffer]> = [
    ['head', head],
    ['hhea', hhea],
    ['hmtx', hmtx],
    ['loca', loca],
    ['maxp', maxp],
    ['name', name],
    ['post', post],
    ['glyf', glyf],
  ]
  if (os2) tables.push(['OS/2', os2])
  tables.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  const numTables = tables.length
  const searchRange = 2 ** Math.floor(Math.log2(numTables)) * 16
  const header = Buffer.alloc(12)
  header.writeUInt32BE(0x00010000, 0) // sfnt version
  header.writeUInt16BE(numTables, 4)
  header.writeUInt16BE(searchRange, 6)
  header.writeUInt16BE(Math.log2(searchRange / 16), 8)
  header.writeUInt16BE(numTables * 16 - searchRange, 10)

  const directory = Buffer.alloc(numTables * 16)
  let offset = 12 + numTables * 16
  const bodies: Buffer[] = []
  tables.forEach(([tag, data], index) => {
    directory.write(tag, index * 16, 'latin1')
    const padded = pad4(data)
    directory.writeUInt32BE(checksum(padded), index * 16 + 4)
    directory.writeUInt32BE(offset, index * 16 + 8)
    directory.writeUInt32BE(data.length, index * 16 + 12)
    bodies.push(padded)
    offset += padded.length
  })

  const subset = Buffer.concat([header, directory, ...bodies])
  // head.checkSumAdjustment: 0xB1B0AFBA minus the checksum of the whole file
  // (with the field zeroed, which it is at this point).
  const adjustment = (0xb1b0afba - checksum(subset)) >>> 0
  const headOffset = directory.readUInt32BE(tables.findIndex(([tag]) => tag === 'head') * 16 + 8)
  subset.writeUInt32BE(adjustment, headOffset + 8)

  return {
    ttf: subset,
    gidFor: lookup,
    widthOf: (gid: number) => {
      if (gid < 0 || gid >= numGlyphs) return 0
      return hmtx.readUInt16BE(gid * 4)
    },
    unitsPerEm: font.unitsPerEm,
    bbox: font.bbox,
    ascent: font.ascent,
    descent: font.descent,
  }
}

/** Flate-compressed font stream plus its uncompressed length, for /FontFile2. */
export function fontStream(font: EmbeddedFont): { data: Buffer; length1: number; compressed: boolean } {
  const deflated = deflateSync(font.ttf)
  // Only worth compressing if it actually shrinks.
  if (deflated.length < font.ttf.length) {
    return { data: deflated, length1: font.ttf.length, compressed: true }
  }
  return { data: font.ttf, length1: font.ttf.length, compressed: false }
}
