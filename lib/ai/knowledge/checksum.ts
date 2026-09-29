/**
 * Phase 4 — Checksums (stable, deterministic).
 * sha256 over a canonical (NFKC, whitespace-collapsed, lowercased-for-dup
 * comparison) form, so reformatting never defeats dedup.
 */
import { createHash } from 'node:crypto'

export function normalizeForHash(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Content checksum used for corpus-level dedup. */
export function contentHash(text: string): string {
  return sha256Hex(normalizeForHash(text))
}

/** Chunk checksum (per-chunk text identity). */
export function chunkChecksum(text: string): string {
  return sha256Hex(normalizeForHash(text))
}
