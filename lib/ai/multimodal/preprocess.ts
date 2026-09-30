/**
 * Phase 6 — deterministic image preprocessing (§12).
 *
 * - The ORIGINAL artifact is immutable: it is stored once, never rewritten.
 * - Every derivative (grayscale/normalized model input) is a NEW object with
 *   its own key + checksum, chained to the original (preprocess provenance).
 * - All geometry (dimensions, pixel count) is SERVER-measured, so a client
 *   can never lie about an image's size (pixel-bomb guard, §32).
 */

import { createHash } from 'crypto'
import { getStorage } from '@/lib/storage'
import { MultimodalError, PREPROCESS_VERSION } from './types'
import type { PreprocessResult } from './types'
import { MULTIMODAL_LIMITS } from './limits'

export interface ProcessedImage {
  original: Buffer
  width: number
  height: number
  pixelCount: number
  /** Grayscale derivative bytes (JPEG, q85) — the model-input normalization. */
  derivative: Buffer | null
}

/**
 * Decode + measure + normalize an image. Pure over the input bytes
 * (storage is touched only by the caller via `persist`).
 */
export async function preprocessImage(original: Buffer): Promise<ProcessedImage> {
  let Jimp: typeof import('jimp')['Jimp']
  try {
    ;({ Jimp } = await import('jimp'))
  } catch {
    throw new MultimodalError('PREPROCESSING_FAILED', 'image decoder unavailable')
  }

  // Note: `img` is deliberately UN-annotated — a static import('jimp') type
  // annotation resolves through a different declaration file than the
  // dynamic import (dual-package hazard: "two unrelated types with this
  // name"). Inference from the single dynamic import stays self-consistent.
  let img
  try {
    img = await Jimp.read(original)
  } catch {
    throw new MultimodalError('INVALID_FORMAT', 'file passed signature check but is not a decodable image')
  }

  const width = img.bitmap.width
  const height = img.bitmap.height
  const pixelCount = width * height
  if (pixelCount > MULTIMODAL_LIMITS.maxPixelCount) {
    throw new MultimodalError('OVERSIZED_INPUT', `image exceeds max pixel count (${pixelCount})`)
  }

  // Derivative: grayscale copy (contrast-preserving; no geometric distortion).
  // jimp v1: `getBuffer(mime, options)` (quality is an encoding option).
  const derivative = await img
    .clone()
    .greyscale()
    .getBuffer('image/jpeg', { quality: 85 })

  return { original, width, height, pixelCount, derivative }
}

/**
 * Persist original + derivative and record provenance. The ORIGINAL is
 * written exactly once, to `originalKey` (the attachment row's canonical
 * key); the derivative gets its own key — the original is never rewritten
 * (§12: original → derivative → version → checksum).
 */
export async function persistPreprocessed(
  image: ProcessedImage,
  keys: { originalKey: string; derivativeKey: string },
): Promise<PreprocessResult> {
  const storage = getStorage()
  await storage.put(keys.originalKey, image.original, { contentType: 'image/jpeg' })

  const derivatives: PreprocessResult['derivatives'] = []
  if (image.derivative) {
    await storage.put(keys.derivativeKey, image.derivative, { contentType: 'image/jpeg' })
    derivatives.push({
      key: keys.derivativeKey,
      kind: 'grayscale_q85',
      sha256: sha256Hex(image.derivative),
      width: image.width,
      height: image.height,
    })
  }

  return {
    originalKey: keys.originalKey,
    originalSha256: sha256Hex(image.original),
    width: image.width,
    height: image.height,
    pixelCount: image.pixelCount,
    derivatives,
    version: PREPROCESS_VERSION,
  }
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Mesh cell count estimate from OBJ/PLY/STL bytes (bounds check, §32).
 * The engine's own parser is the final authority; this only rejects
 * pathological files before they reach the engine.
 */
export function estimateMeshCells(buf: Buffer): number {
  const text = buf.toString('utf8', 0, Math.min(buf.length, 2_000_000))
  // Binary STL: triangle count at byte 80
  if (buf.length >= 84) {
    const n = buf.readUInt32LE(80)
    if (n > 0 && n < 100_000_000 && buf.length >= 84 + n * 50) return n * 3 // triangles → ~cells
  }
  const vLines = (text.match(/^v[ \t]/gm) ?? []).length
  if (vLines > 0) return vLines
  // PLY ascii: "element vertex N"
  const m = text.match(/element\s+vertex\s+(\d+)/i)
  if (m) return Number(m[1])
  return 0
}
