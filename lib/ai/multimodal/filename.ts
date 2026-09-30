/**
 * Phase 6 — filename handling (§8: sanitization; §9: filename injection).
 *
 * The original name is UNTRUSTED DATA: it is sanitized for display and its
 * extension is ignored for type decisions (the magic bytes decide). A
 * storage name is generated server-side (uuid + a safe extension derived
 * from the DETECTED class). Path traversal, control characters, and
 * pathological names are rejected before anything is stored.
 */

import { MultimodalError } from './types'
import { MULTIMODAL_LIMITS } from './limits'

/** Extensions we allow as the STORAGE extension, per detected class. */
const SAFE_EXTENSIONS: Record<string, string> = {
  IMAGE_2D: 'jpg', // re-encoded derivatives are jpeg/png; originals keep their detected ext below
  MESH_3D: 'obj',
  DOCUMENT_PDF: 'pdf',
  DOCUMENT_TEXT: 'txt',
  VOLUME_DICOM: 'dcm',
  UNKNOWN: 'bin',
}

const IMAGE_EXTS_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * Sanitize a client-supplied display name.
 * Returns a safe name for storage records (NEVER used as a filesystem path).
 */
export function sanitizeOriginalName(raw: string): string {
  // NFKC normalization (Unicode confusables collapse to one form)
  let name = (raw ?? '').normalize('NFKC')
  // Strip control chars + path separators (unix AND windows) + nulls
  name = name.replace(/[\u0000-\u001f\u007f/\\]/g, '_')
  // §9 — the name is DATA: it must never be able to open a tag, attribute
  // or script context in any UI that renders it (stored-XSS / injection).
  name = name.replace(/[<>`"'&]/g, '')
  // Collapse dot-dot / dot segments that could read as traversal in any UI
  name = name.replace(/\.{2,}/g, '.').replace(/^\.+/, '').trim()
  name = name.replace(/\s+/g, ' ')
  if (name.length > MULTIMODAL_LIMITS.maxOriginalNameLen) {
    name = name.slice(0, MULTIMODAL_LIMITS.maxOriginalNameLen).trim()
  }
  if (!name) name = 'attachment'
  return name
}

/**
 * Reject names that are structurally dangerous even after sanitization
 * (defense in depth — the sanitized value is what gets stored, and this
 * check guards the raw input boundary, e.g. for audit logging).
 */
export function assertNameNotTraversing(raw: string): void {
  if (/(\.\.[/\\])|(^[/\\])|(\\[a-zA-Z]:)/.test(raw)) {
    throw new MultimodalError('PATH_TRAVERSAL_REJECTED', 'filename contains path traversal')
  }
}

/**
 * Build the server-side storage name: uuid + safe extension.
 * The client extension is consulted ONLY as a cosmetic hint for images/mesh
 * when it matches what the bytes said — otherwise the detected default.
 */
export function buildStorageFileName(
  fileClass: string,
  mediaType: string,
  clientExtension: string | null,
  uuid: string,
): string {
  let ext: string
  if (fileClass === 'IMAGE_2D') {
    const detected = IMAGE_EXTS_BY_MIME[mediaType] ?? 'jpg'
    ext = clientExtension && IMAGE_EXTS_BY_MIME[mediaType] === clientExtension ? clientExtension : detected
  } else {
    ext = SAFE_EXTENSIONS[fileClass] ?? 'bin'
  }
  return `${uuid}.${ext.toLowerCase()}`
}
