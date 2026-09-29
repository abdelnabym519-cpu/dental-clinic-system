// @ts-nocheck
/**
 * Phase 4 — Deterministic chunking: semantic boundaries, no arbitrary
 * slicing, stable positions/checksums.
 */
import { describe, it, expect } from 'vitest'
import { chunkContent, DEFAULT_CHUNKING } from '@/lib/ai/knowledge/chunking'
import { chunkChecksum } from '@/lib/ai/knowledge/checksum'

const DOC = `# Diagnosis
Periodontitis is diagnosed when probing depths exceed 4 mm together with clinical attachment loss. Radiographic bone loss supports the diagnosis in most cases and must be compared with the previous radiograph before a definitive stage and grade are assigned.
# Treatment
Teeth with probing depths greater than 6 mm are not automatically extracted. Non-surgical therapy with scaling and root planing is the first-line standard of care, followed by re-evaluation after a healing period of six to eight weeks before any surgical option is considered.
# Home Care
Plaque control is the foundation of maintenance. Brush twice daily with a soft brush and use an interdental brush where the patient can tolerate it. Compliance is reviewed at every maintenance visit and adapted to the recorded bleeding score.`

describe('chunking', () => {
  it('splits on heading boundaries and records the section path', () => {
    const chunks = chunkContent(DOC, { ...DEFAULT_CHUNKING, maxChars: 600, targetChars: 500 })
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    for (const c of chunks) expect(c.section).toBeTruthy()
    expect(chunks.some((c) => c.section === 'Diagnosis')).toBe(true)
    expect(chunks.some((c) => c.section === 'Home Care')).toBe(true)
    // every section's text is present in some chunk
    expect(chunks.flatMap((c) => c.text).join(' ')).toContain('interdental brush')
  })

  it('keeps table rows whole (no mid-table slicing)', () => {
    const doc = `# Materials
| Material | Indication |
|----------|------------|
| GIC | cervical lesions |
| Amalgam | posterior |
` + 'x'.repeat(900)
    const chunks = chunkContent(doc)
    const tableChunk = chunks.find((c) => c.text.includes('| Material |'))
    expect(tableChunk).toBeTruthy()
    expect(tableChunk.text).toContain('| Amalgam | posterior |')
    expect(tableChunk.text.includes('\n| GIC')).toBe(true)
  })

  it('groups list items into one unit', () => {
    const doc = `# Signs
- bleeding on probing
- suppuration
- furcation involvement
The three signs together suggest active periodontitis and require full charting.`
    const chunks = chunkContent(doc)
    const listChunk = chunks.find((c) => c.text.includes('- bleeding on probing'))
    expect(listChunk).toBeTruthy()
    expect(listChunk.text).toContain('- furcation involvement')
  })

  it('splits oversized paragraphs on sentence boundaries (never mid-sentence)', () => {
    const sentences = Array.from({ length: 30 }, (_, i) => `Sentence number ${i + 1} describes a periodontal finding in detail for patient cohort ${i}.`)
    const doc = `# Findings\n${sentences.join(' ')}`
    const chunks = chunkContent(doc, { ...DEFAULT_CHUNKING, maxChars: 400, targetChars: 300 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(401)
      // every fragment (except the tail marker) ends on a sentence end
      const body = c.text.replace(/ …$/, '')
      expect(/(?<=[.!?])\s*$/.test(body) || body.split('. ').length === 1).toBe(true)
    }
  })

  it('positions are dense and ordered', () => {
    const chunks = chunkContent(DOC)
    expect(chunks.map((c) => c.position)).toEqual(chunks.map((_, i) => i))
  })

  it('is deterministic: same input → same chunks and checksums', () => {
    const a = chunkContent(DOC)
    const b = chunkContent(DOC)
    expect(a).toEqual(b)
    expect(a.map((c) => chunkChecksum(c.text))).toEqual(b.map((c) => chunkChecksum(c.text)))
  })

  it('merges tiny trailing sections into the previous chunk', () => {
    const big = 'Probing depths were measured at six sites per tooth and recorded for every sextant of the arch during this periodontal examination. '
    const doc = `# Body
${big.repeat(5)}
# Note
A short tail.`
    const chunks = chunkContent(doc)
    expect(chunks.some((c) => c.text.includes('A short tail.'))).toBe(true)
    const tailChunk = chunks.find((c) => c.text.includes('A short tail.'))
    // the tail (13 chars < minChars 160) must have been merged with the big chunk
    expect(tailChunk.text.length).toBeGreaterThanOrEqual(DEFAULT_CHUNKING.minChars)
  })

  it('handles Arabic headings and content', () => {
    const doc = `# الفلوريد
يُستخدم الفلوريد لتقوية مينا الأسنان والوقاية من تسوس الأسنان لدى الأطفال.
# طبقة العزل
تُطبَّق طبقة العزل الوقائي على الأضراس الدائمة عند بزوغها.`
    const chunks = chunkContent(doc)
    expect(chunks.some((c) => c.section === 'الفلوريد')).toBe(true)
    expect(chunks.some((c) => c.text.includes('الوقاية من تسوس الأسنان'))).toBe(true)
  })

  it('returns no chunks for empty content', () => {
    expect(chunkContent('')).toEqual([])
    expect(chunkContent('   \n  ')).toEqual([])
  })
})
