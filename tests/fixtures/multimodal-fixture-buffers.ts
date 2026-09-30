/**
 * Phase 6 — deterministic fixture buffers for multimodal tests (§36).
 *
 * Every fixture is constructed by BYTES (signature is what the service
 * trusts), never by extension. Injection payloads are content, not
 * commands: they must survive the pipeline as inert data.
 */

import zlib from 'node:zlib'
import { Jimp } from 'jimp'

// ── Minimal PNG encoder (IHDR/IDAT/IEND, 8-bit RGB, filter 0) ──────────────
let CRC_TABLE: number[] | null = null
function crc32(buf: Buffer): number {
  if (!CRC_TABLE) {
    CRC_TABLE = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** A real, decodable solid-color PNG of exactly (width × height). */
export function pngBuffer(width = 48, height = 32, rgb: [number, number, number] = [255, 0, 0]): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor RGB
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = rgb[0]
    row[1 + x * 3 + 1] = rgb[1]
    row[1 + x * 3 + 2] = rgb[2]
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** Small real JPEG (a decodable PNG round-tripped through jimp). */
export async function jpegBuffer(width = 48, height = 32): Promise<Buffer> {
  const img = await Jimp.read(pngBuffer(width, height, [0, 255, 0]))
  return await img.getBuffer('image/jpeg')
}

/** Pixel bomb: decoded bitmap exceeds MULTIMODAL_LIMITS.maxPixelCount (40M).
 *  Solid color → tiny on disk, but decoding blows the guard. */
export function pixelBombPng(width = 6500, height = 6200): Buffer {
  return pngBuffer(width, height, [255, 255, 255])
}

/** Corrupt a valid PNG so the signature passes but jimp cannot decode it. */
export function corruptedPng(): Buffer {
  const png = pngBuffer(32, 32)
  const out = Buffer.from(png)
  out.fill(0, 33, out.length)
  return out
}

/** Minimal valid DICOM file: 128-byte preamble + DICM + one meta element. */
export function dicomBuffer(): Buffer {
  const buf = Buffer.alloc(132 + 8)
  buf.write('DICM', 128, 'ascii')
  // (0002,0000) group length, OB, length 0
  buf.writeUInt16LE(0x0002, 132)
  buf.writeUInt16LE(0x0000, 134)
  buf.write('OB', 136, 'ascii')
  buf.writeUInt16LE(0, 138)
  return buf
}

/** Minimal ASCII STL (signature-detected mesh). */
export function asciiStlBuffer(): Buffer {
  return Buffer.from(
    [
      'solid fixture',
      'facet normal 0 0 1',
      'outer loop',
      'vertex 0 0 0',
      'vertex 1 0 0',
      'vertex 0 1 0',
      'endloop',
      'endfacet',
      'endsolid fixture',
      '',
    ].join('\n'),
    'utf8',
  )
}

/** Minimal OBJ (signature-detected mesh). */
export function objBuffer(): Buffer {
  return Buffer.from(
    ['# fixture mesh', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3', ''].join('\n'),
    'utf8',
  )
}

/**
 * A structurally valid minimal single-page PDF carrying `text`.
 * The xref table is computed for real, so pdf.js parses it cleanly.
 */
export function minimalPdfBuffer(text: string): Buffer {
  const safe = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  const content = `BT /F1 12 Tf 72 720 Td (${safe}) Tj ET`
  const objects: string[] = []
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`
  objects[2] = `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`
  objects[3] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
    `/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`
  objects[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  objects[5] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefPos = pdf.length
  pdf += `xref\n0 6\n0000000000 65535 f \n`
  for (let i = 1; i <= 5; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

/** Plain text document (signature: printable ASCII). */
export function textDocumentBuffer(text: string): Buffer {
  return Buffer.from(text, 'utf8')
}

/** Recognized executable magic (ELF) — must NEVER be treated as an image. */
export function elfBuffer(): Buffer {
  const buf = Buffer.alloc(64)
  buf.write('\x7fELF', 0, 'latin1')
  return buf
}
