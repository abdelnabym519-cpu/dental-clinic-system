/**
 * Phase 4 — Query/content normalization (deterministic, bilingual).
 *
 * Tokenization is Unicode-aware (Latin words, Arabic runs, numbers). Term
 * expansion uses an EXPLICIT, versioned map of well-established dental
 * equivalences — no invented mappings, no learning. Matching is symmetric:
 * query terms and chunk text are both projected onto canonical terms, so a
 * "root canal" query matches a chunk containing "قناة الجذر" and vice versa.
 */

export const TERMS_VERSION = 'phase4-2026-09-v1'

interface TermEntry {
  canonical: string
  surfaces: string[] // all surface forms (EN + AR)
  domains?: string[] // optional domain hint
}

/**
 * Curated dental terminology map. Every entry is a standard, widely used
 * equivalence (not an inference). Phrase entries are matched before single
 * tokens (longest-first).
 */
const TERM_MAP: TermEntry[] = [
  { canonical: 'root-canal', surfaces: ['root canal', 'root canals', 'root-canal', 'قناة الجذر', 'قنوات الجذر', 'العصب', 'عصب السن'], domains: ['ENDODONTICS'] },
  { canonical: 'pulp', surfaces: ['pulp', 'pulpitis', 'نخاع السن', 'التهاب العصب'], domains: ['ENDODONTICS'] },
  { canonical: 'gingivitis', surfaces: ['gingivitis', 'gingival inflammation', 'التهاب اللثة'], domains: ['PERIODONTOLOGY'] },
  { canonical: 'periodontitis', surfaces: ['periodontitis', 'التهاب دواعم السن'], domains: ['PERIODONTOLOGY'] },
  { canonical: 'caries', surfaces: ['caries', 'cavity', 'cavities', 'carious', 'تسوس', 'تسوس الأسنان'], domains: ['RESTORATIVE'] },
  { canonical: 'filling', surfaces: ['filling', 'fillings', 'حشو', 'حشوة'], domains: ['RESTORATIVE'] },
  { canonical: 'crown', surfaces: ['crown', 'crowns', 'التاج', 'تاج الأسنان'], domains: ['PROSTHODONTICS'] },
  { canonical: 'bridge', surfaces: ['dental bridge', 'bridges', 'جسر الأسنان', 'الجسر'], domains: ['PROSTHODONTICS'] },
  { canonical: 'implant', surfaces: ['implant', 'implants', 'زراعة الأسنان', 'زراعة السن'], domains: ['IMPLANTOLOGY'] },
  { canonical: 'extraction', surfaces: ['extraction', 'extractions', 'قلع', 'خلع', 'سحب السن'], domains: ['SURGERY'] },
  { canonical: 'wisdom-tooth', surfaces: ['wisdom tooth', 'wisdom teeth', 'سن العقل'], domains: ['SURGERY'] },
  { canonical: 'orthodontics', surfaces: ['orthodontics', 'orthodontic', 'braces', 'تقويم الأسنان', 'تقويم'], domains: ['ORTHODONTICS'] },
  { canonical: 'fluoride', surfaces: ['fluoride', 'الفلوريد'], domains: ['PEDIATRIC_SPECIAL_CARE'] },
  { canonical: 'sealants', surfaces: ['sealant', 'sealants', 'طبقة العزل', 'العزل الوقائي'], domains: ['PEDIATRIC_SPECIAL_CARE'] },
  { canonical: 'amalgam', surfaces: ['amalgam', 'الاملغم', 'الزئبق'], domains: ['RESTORATIVE'] },
  { canonical: 'composite', surfaces: ['composite', 'composites', 'الكومبوزيت'], domains: ['RESTORATIVE'] },
  { canonical: 'denture', surfaces: ['denture', 'dentures', 'الطقم', 'أطقم الأسنان'], domains: ['PROSTHODONTICS'] },
  { canonical: 'oral-ulcer', surfaces: ['oral ulcer', 'oral ulcers', 'aphthous', 'قرح الفم', 'قرحة الفم'], domains: ['ORAL_MEDICINE'] },
  { canonical: 'radiography', surfaces: ['x-ray', 'xray', 'x-rays', 'radiograph', 'radiographs', 'الأشعة', 'اشعة', 'الأشعة السينية'], domains: ['IMAGING_DIGITAL'] },
  { canonical: 'panoramic', surfaces: ['panoramic', 'panoramic radiograph', 'بانورامي'], domains: ['IMAGING_DIGITAL'] },
  { canonical: 'cbct', surfaces: ['cbct', 'cone beam', 'المحور المخروطي'], domains: ['IMAGING_DIGITAL'] },
  { canonical: 'pain', surfaces: ['pain', 'painful', 'ألم', 'وجع'], domains: [] },
  { canonical: 'bleeding-gums', surfaces: ['bleeding gums', 'gum bleeding', 'نزيف اللثة', 'نزيف من اللثة'], domains: ['PERIODONTOLOGY'] },
  { canonical: 'plaque', surfaces: ['plaque', 'البلاك'], domains: ['PERIODONTOLOGY'] },
  { canonical: 'swelling', surfaces: ['swelling', 'swollen', 'التورم', 'تورم'], domains: [] },
  { canonical: 'numbness', surfaces: ['numbness', 'numb', 'تنميل'], domains: [] },
  { canonical: 'tooth', surfaces: ['tooth', 'teeth', 'سن', 'أسنان', 'الأسنان'], domains: [] },
  { canonical: 'gum', surfaces: ['gum', 'gums', 'اللثة', 'الأسنان واللثة'], domains: ['PERIODONTOLOGY'] },
  { canonical: 'jaw', surfaces: ['jaw', 'الفك'], domains: ['ORAL_MEDICINE'] },
  { canonical: 'guideline', surfaces: ['guideline', 'guidelines', 'خط إرشادي', 'الإرشادات', 'البروتوكول'], domains: [] },
  { canonical: 'diagnosis', surfaces: ['diagnosis', 'diagnostic', 'diagnose', 'تشخيص', 'التشخيص'], domains: ['DIAGNOSIS'] },
  { canonical: 'treatment', surfaces: ['treatment', 'treatments', 'العلاج', 'العلاجات'], domains: [] },
]

// Surface form → canonical (longest-first for matching).
const SURFACE_TO_CANONICAL: Array<[string, string]> = TERM_MAP.flatMap((e) =>
  e.surfaces.map((s) => [s.toLowerCase(), e.canonical] as [string, string])
).sort((a, b) => b[0].length - a[0].length)

const CANONICAL_DOMAINS = new Map<string, string[]>()
for (const e of TERM_MAP) if (e.domains?.length) CANONICAL_DOMAINS.set(e.canonical, e.domains)

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

/** Unicode-aware tokens: Latin words + Arabic runs (case-folded, scan order). */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens: string[] = []
  const re = /[\u0600-\u06FF]+|[a-z0-9][a-z0-9\-']*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(lower)) !== null) tokens.push(m[0])
  return tokens
}

/** Curated stop words (bilingual). Only well-known function words. */
const STOPWORDS = new Set([
  // EN
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'that', 'this', 'these',
  'those', 'it', 'its', 'as', 'at', 'by', 'from', 'do', 'does', 'did', 'what',
  'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'can', 'could', 'may',
  'might', 'shall', 'should', 'will', 'would', 'must', 'need', 'about', 'into',
  'over', 'under', 'per', 'via', 'please', 'tell', 'show', 'give', 'list',
  'explain', 'describe', 'i', 'you', 'he', 'she', 'we', 'they', 'me', 'my',
  'your', 'our', 'their', 'not', 'no', 'yes', 'if', 'then', 'than', 'so',
  'such', 'each', 'any', 'all', 'some', 'other', 'more', 'most', 'very',
  // AR
  'في', 'على', 'من', 'إلى', 'الى', 'ما', 'هل', 'هو', 'هي', 'هذا', 'هذه',
  'التي', 'الذين', 'مع', 'عن', 'عند', 'بعد', 'قبل', 'بين', 'كل', 'لا',
  'نعم', 'قد', 'ثم', 'أي', 'اي', 'مثل', 'هو', 'هم', 'نحن', 'أنتم', 'أنت',
  'أنا', 'كان', 'كانت', 'يكون', 'تكون', 'إذا', 'فإذا', 'او', 'و', 'ثم',
])

export function filterStopwords(tokens: string[]): string[] {
  return tokens.filter((t) => !STOPWORDS.has(t) && t.length > 1)
}

// ---------------------------------------------------------------------------
// Term projection (the bilingual bridge)
// ---------------------------------------------------------------------------

/**
 * Find canonical terms present in a text. Longest-first surface matching:
 * a surface form consumes the text span so overlapping shorter forms do not
 * double-match (e.g. "قناة الجذر" wins over "الجذر" alone).
 */
export function canonicalTerms(text: string): Map<string, string[]> {
  const lower = text.toLowerCase()
  const found = new Map<string, string[]>()
  const consumed: Array<[number, number]> = []
  for (const [surface, canonical] of SURFACE_TO_CANONICAL) {
    let idx = lower.indexOf(surface)
    while (idx !== -1) {
      const end = idx + surface.length
      const overlaps = consumed.some(([s, e]) => idx < e && end > s)
      if (!overlaps) {
        consumed.push([idx, end])
        const list = found.get(canonical) ?? []
        list.push(surface)
        found.set(canonical, list)
        break // one hit per surface is enough for matching
      }
      idx = lower.indexOf(surface, idx + 1)
    }
  }
  return found
}

export interface NormalizedQuery {
  raw: string
  tokens: string[] // content tokens (stopwords removed)
  terms: Map<string, string[]> // canonical → surface forms hit in the query
  language: 'en' | 'ar' | 'mixed'
}

export function detectLanguage(text: string): 'en' | 'ar' | 'mixed' {
  const ar = (text.match(/[\u0600-\u06FF]/g) ?? []).length
  const en = (text.match(/[a-zA-Z]/g) ?? []).length
  if (ar === 0 && en === 0) return 'en'
  if (ar === 0) return 'en'
  if (en === 0) return 'ar'
  return 'mixed'
}

export function normalizeQuery(raw: string): NormalizedQuery {
  const tokens = filterStopwords(tokenize(raw))
  return { raw: raw.trim(), tokens, terms: canonicalTerms(raw), language: detectLanguage(raw) }
}

/**
 * Chunk-side projection: content tokens + canonical terms. Computed once at
 * index build time (deterministic; no per-query rescanning of the corpus).
 */
export function projectChunkText(text: string): { tokens: Set<string>; terms: Map<string, string[]> } {
  return { tokens: new Set(filterStopwords(tokenize(text))), terms: canonicalTerms(text) }
}

export function canonicalDomains(terms: Map<string, string[]>): string[] {
  const out = new Set<string>()
  for (const canonical of terms.keys()) {
    for (const d of CANONICAL_DOMAINS.get(canonical) ?? []) out.add(d)
  }
  return [...out]
}

export { STOPWORDS, TERM_MAP }
