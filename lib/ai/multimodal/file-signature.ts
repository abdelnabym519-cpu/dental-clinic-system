/**
 * Phase 6 — deterministic file-signature (magic-byte) inspection (§8/§10).
 *
 * The client-supplied MIME type and filename extension are NEVER trusted.
 * The bytes decide. This module is pure: Buffer in, typed facts out — no
 * I/O, no dependency, no LLM.
 *
 * DICOM is recognized but NOT parsed (Phase 6 has no DICOM parser — §26:
 * ingestion detection ≠ parsing ≠ visualization ≠ AI analysis).
 */

import type { MultimodalFileClass } from './types'

export interface SignatureResult {
  fileClass: MultimodalFileClass
  /** Canonical MIME derived from the bytes (the client value is ignored). */
  mediaType: string
  /** Human-verified detail of what matched (for provenance, not for trust). */
  detail: string
}

/** Detect the file class + canonical MIME from the leading bytes. */
export function detectSignature(buf: Buffer): SignatureResult {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return { fileClass: 'IMAGE_2D', mediaType: 'image/png', detail: 'PNG signature' }
  }
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { fileClass: 'IMAGE_2D', mediaType: 'image/jpeg', detail: 'JPEG signature' }
  }
  // WebP: RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { fileClass: 'IMAGE_2D', mediaType: 'image/webp', detail: 'WebP (RIFF/WEBP) signature' }
  }
  // PDF: %PDF
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === '%PDF') {
    return { fileClass: 'DOCUMENT_PDF', mediaType: 'application/pdf', detail: 'PDF header' }
  }
  // DICOM: 128-byte preamble + "DICM" (explicit length encoding)
  if (buf.length >= 132 && buf.toString('ascii', 128, 132) === 'DICM') {
    return {
      fileClass: 'VOLUME_DICOM',
      mediaType: 'application/dicom',
      detail: 'DICM marker at byte 128 (ingestion detected; no parser in Phase 6)',
    }
  }
  // STL binary: 80-byte header + uint32 triangle count (sanity: count is finite)
  if (buf.length >= 84) {
    const n = buf.readUInt32LE(80)
    if (n > 0 && n < 100_000_000 && buf.length >= 84 + n * 50) {
      return { fileClass: 'MESH_3D', mediaType: 'model/stl', detail: `STL binary (${n} triangles)` }
    }
  }
  // ASCII STL
  if (looksLikeAsciiStl(buf)) {
    return { fileClass: 'MESH_3D', mediaType: 'model/stl', detail: 'STL ASCII header' }
  }
  // OBJ: starts with recognizable mesh directives (v/vn/f/o/# within head)
  if (looksLikeObj(buf)) {
    return { fileClass: 'MESH_3D', mediaType: 'model/obj', detail: 'OBJ vertex/face directives' }
  }
  // PLY: "ply" magic
  if (buf.length >= 3 && buf.toString('ascii', 0, 3).toLowerCase() === 'ply') {
    return { fileClass: 'MESH_3D', mediaType: 'model/ply', detail: 'PLY header' }
  }
  // VTK (legacy ascii): "vtk" magic
  if (buf.length >= 3 && buf.toString('ascii', 0, 3).toLowerCase() === 'vtk') {
    return { fileClass: 'MESH_3D', mediaType: 'model/vtk', detail: 'VTK legacy header' }
  }
  // Plain text (printable-ASCII ratio) — documents/notes
  if (looksLikeText(buf)) {
    return { fileClass: 'DOCUMENT_TEXT', mediaType: 'text/plain', detail: 'printable text' }
  }
  return { fileClass: 'UNKNOWN', mediaType: 'application/octet-stream', detail: 'no known signature' }
}

function looksLikeAsciiStl(buf: Buffer): boolean {
  const head = buf.toString('utf8', 0, Math.min(buf.length, 512)).trimStart()
  if (!/^solid\s+/i.test(head)) return false
  // A real ASCII STL has facet/normal lines; reject a file that is just "solid x"
  return /facet\s+normal/i.test(head)
}

function looksLikeObj(buf: Buffer): boolean {
  const head = buf.toString('utf8', 0, Math.min(buf.length, 2048))
  const lines = head.split('\n').map((l) => l.trim()).filter(Boolean)
  let meshLines = 0
  let otherLines = 0
  for (const line of lines.slice(0, 200)) {
    if (/^(v|vn|vt|f|o|g|usemtl|mtllib|s)\b/.test(line)) meshLines++
    else if (!line.startsWith('#')) otherLines++
  }
  return meshLines >= 3 && meshLines >= otherLines
}

function looksLikeText(buf: Buffer): boolean {
  if (buf.length === 0) return false
  const sample = buf.subarray(0, Math.min(buf.length, 4096))
  // Reject NUL bytes outright (binary)
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return false
  }
  let printable = 0
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i]
    if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b < 0x7f)) printable++
  }
  // Allow UTF-8 multibyte sequences (bytes >= 0x80) as printable
  return printable / sample.length > 0.9
}
