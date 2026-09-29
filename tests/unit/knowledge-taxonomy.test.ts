// @ts-nocheck
/**
 * Phase 4 — Controlled taxonomy: closed vocabulary, deterministic domain
 * detection, EN+AR terms, no invented categories.
 */
import { describe, it, expect } from 'vitest'
import {
  KNOWLEDGE_DOMAINS, TAXONOMY_SUBTOPICS, DOMAIN_LABELS,
  isKnowledgeDomain, isSubtopic, detectDomains, primaryDomain,
} from '@/lib/ai/knowledge/taxonomy'

describe('knowledge taxonomy', () => {
  it('has the 12 controlled top-level domains', () => {
    expect(KNOWLEDGE_DOMAINS).toHaveLength(12)
    for (const d of KNOWLEDGE_DOMAINS) {
      expect(DOMAIN_LABELS[d]).toBeTruthy()
      expect(TAXONOMY_SUBTOPICS[d].length).toBeGreaterThan(0)
    }
  })

  it('rejects unknown domains (closed vocabulary)', () => {
    expect(isKnowledgeDomain('CARDIOLOGY')).toBe(false)
    expect(isKnowledgeDomain('general-ai')).toBe(false)
    expect(isKnowledgeDomain('')).toBe(false)
    expect(isKnowledgeDomain(undefined)).toBe(false)
    expect(isKnowledgeDomain('ENDODONTICS')).toBe(true)
  })

  it('subtopics are validated per domain', () => {
    expect(isSubtopic('ENDODONTICS', 'root-canal-treatment')).toBe(true)
    expect(isSubtopic('ENDODONTICS', 'fluoride')).toBe(false) // belongs to pediatric
    expect(isSubtopic('PEDIATRIC_SPECIAL_CARE', 'fluoride')).toBe(true)
  })

  it('detects domains deterministically from English text', () => {
    expect(primaryDomain('diagnosis and treatment of periodontitis with probing depths and attachment loss')).toBe('PERIODONTOLOGY')
    expect(primaryDomain('root canal treatment for irreversible pulpitis with sodium hypochlorite irrigation')).toBe('ENDODONTICS')
    expect(primaryDomain('glass ionomer and composite restorative materials for caries')).toBe('RESTORATIVE')
    expect(primaryDomain('fluoride varnish and sealants for pediatric caries prevention in children')).toBe('PEDIATRIC_SPECIAL_CARE')
    expect(primaryDomain('panoramic radiograph and CBCT interpretation')).toBe('IMAGING_DIGITAL')
  })

  it('detects domains from Arabic text', () => {
    expect(primaryDomain('التهاب اللثة ونزيف اللثة والفحص الدوري')).toBe('PERIODONTOLOGY')
    expect(primaryDomain('علاج عصب السن وقناة الجذر عند الأطفال')).toBe('ENDODONTICS')
    expect(primaryDomain('تقويم الأسنان للأطفال ومشكلة الفك')).toBe('ORTHODONTICS')
  })

  it('returns null for non-dental content (no invented category)', () => {
    expect(primaryDomain('quantum entanglement and photon interference in physics')).toBeNull()
    expect(primaryDomain('stock market trading strategies for crypto')).toBeNull()
  })

  it('domain scoring is stable (deterministic tie-break)', () => {
    const a = detectDomains('periodontitis diagnosis and treatment')
    const b = detectDomains('periodontitis diagnosis and treatment')
    expect(a).toEqual(b)
  })
})
