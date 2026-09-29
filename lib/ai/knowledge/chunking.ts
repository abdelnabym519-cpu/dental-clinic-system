/**
 * Phase 4 — Deterministic chunking (spec §11).
 *
 * Preserves semantic boundaries: headings (markdown `#` or numbered),
 * paragraphs (blank-line separated), list blocks (grouped), table blocks
 * (contiguous `|` rows kept whole). No arbitrary mid-sentence slicing:
 * units are merged/split on sentence boundaries toward a target size, with
 * a hard cap. Same input → same chunks → same checksums (deterministic).
 */

export interface ChunkUnit {
  /** Heading path, e.g. "Diagnosis > Criteria". */
  section: string | null
  text: string
  position: number
}

export interface ChunkingOptions {
  minChars: number
  maxChars: number
  targetChars: number
  maxUnitsPerChunk: number
}

export const DEFAULT_CHUNKING: ChunkingOptions = {
  minChars: 160,
  maxChars: 1200,
  targetChars: 700,
  maxUnitsPerChunk: 6,
}

interface StructuredUnit {
  type: 'heading' | 'paragraph' | 'list' | 'table' | 'text'
  text: string
  level?: number
}

const SENTENCE_END = /(?<=[.!?؛؟])\s+/

function splitSentences(text: string): string[] {
  return text.split(SENTENCE_END).map((s) => s.trim()).filter(Boolean)
}

/** Parse raw content into structured units with heading context. */
function toStructuredUnits(content: string): Array<StructuredUnit & { section: string | null }> {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const units: StructuredUnit[] = []
  const headingStack: string[] = []
  let para: string[] = []
  let list: string[] = []
  let table: string[] = []

  const flushPara = () => {
    if (para.length) { units.push({ type: 'paragraph', text: para.join(' ') }); para = [] }
  }
  const flushList = () => {
    if (list.length) { units.push({ type: 'list', text: list.join('\n') }); list = [] }
  }
  const flushTable = () => {
    if (table.length) { units.push({ type: 'table', text: table.join('\n') }); table = [] }
  }
  const flushAll = () => { flushPara(); flushList(); flushTable() }

  for (const line of lines) {
    const trimmed = line.trim()
    const mdHeading = trimmed.match(/^(#{1,6})\s+(.*)$/)
    const numbered = trimmed.match(/^(\d+)\.\s+([A-Z\u0600-\u06FF].{2,})$/)
    if (mdHeading || numbered) {
      flushAll()
      const level = mdHeading ? mdHeading[1].length : 1
      const title = (mdHeading ? mdHeading[2] : numbered![2]).trim()
      headingStack.length = level - 1
      headingStack.push(title)
      units.push({ type: 'heading', text: title, level })
      continue
    }
    if (!trimmed) { flushAll(); continue }
    if (/^\s*\|.*\|\s*$/.test(line) || /^[-|: ]{3,}$/.test(trimmed)) {
      flushPara(); flushList()
      table.push(line.trim())
      continue
    }
    const listItem = trimmed.match(/^[-*•]\s+(.*)$/)
    if (listItem) {
      flushPara(); flushTable()
      list.push(`- ${listItem[1]}`) // preserve the bullet marker in chunk text
      continue
    }
    flushList(); flushTable()
    para.push(trimmed)
  }
  flushAll()
  void headingStack

  // Attach the nearest preceding heading path to each content unit.
  const out: Array<StructuredUnit & { section: string | null }> = []
  const path: string[] = []
  for (const u of units) {
    if (u.type === 'heading') {
      const level = u.level ?? 1
      path.length = level - 1
      path.push(u.text)
      continue
    }
    out.push({ ...u, section: path.length ? [...path].join(' > ') : null })
  }
  return out
}

/**
 * Merge/split structured units into chunks on sentence boundaries.
 * Tables and lists are kept whole unless a single one exceeds maxChars.
 */
export function chunkContent(content: string, opts: ChunkingOptions = DEFAULT_CHUNKING): ChunkUnit[] {
  const units = toStructuredUnits(content)
  const chunks: Array<{ section: string | null; text: string }> = []
  let current: Array<{ section: string | null; text: string }> = []
  let currentLen = 0

  const close = () => {
    if (current.length) {
      chunks.push({
        section: current.map((c) => c.section).find(Boolean) ?? null,
        text: current.map((c) => c.text).join('\n').trim(),
      })
    }
    current = []
    currentLen = 0
  }

  for (const unit of units) {
    if (unit.type === 'heading') continue // headings only set context
    const text = unit.text
    if (text.length <= opts.maxChars) {
      if (currentLen + text.length + 1 > opts.maxChars || current.length >= opts.maxUnitsPerChunk) close()
      current.push({ section: unit.section, text })
      currentLen += text.length + 1
      if (currentLen >= opts.targetChars) close()
    } else {
      // Oversized unit (big table/paragraph): split on sentence boundaries.
      close()
      if (unit.type === 'table') {
        // Keep tables whole — a split table is useless; cap at maxChars with marker.
        chunks.push({ section: unit.section, text: text.slice(0, opts.maxChars) + ' …' })
        continue
      }
      let buf: string[] = []
      let bufLen = 0
      for (const sentence of splitSentences(text)) {
        if (bufLen + sentence.length + 1 > opts.maxChars && buf.length) {
          chunks.push({ section: unit.section, text: buf.join(' ') })
          buf = []
          bufLen = 0
        }
        buf.push(sentence)
        bufLen += sentence.length + 1
      }
      if (buf.length) chunks.push({ section: unit.section, text: buf.join(' ') })
    }
  }
  close()

  // Re-merge tiny tail chunks into the previous one when safe.
  const merged: Array<{ section: string | null; text: string }> = []
  for (const c of chunks) {
    const prev = merged[merged.length - 1]
    if (prev && c.text.length < opts.minChars && prev.text.length + c.text.length + 1 <= opts.maxChars) {
      prev.text = `${prev.text}\n${c.text}`
    } else {
      merged.push({ ...c })
    }
  }

  return merged
    .filter((c) => c.text.length > 0)
    .map((c, i) => ({ section: c.section, text: c.text, position: i }))
}
