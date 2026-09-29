/**
 * Phase 4 — Controlled dental knowledge taxonomy.
 *
 * A CLOSED vocabulary. Top-level domains + subtopics are aligned with the
 * approved dental domains. Everything else is UNKNOWN — the taxonomy never
 * invents categories, and domain classification is deterministic keyword
 * scoring against the curated maps below.
 */

export const KNOWLEDGE_DOMAINS = [
  'FOUNDATIONAL',
  'DIAGNOSIS',
  'RESTORATIVE',
  'ENDODONTICS',
  'PERIODONTOLOGY',
  'PROSTHODONTICS',
  'IMPLANTOLOGY',
  'SURGERY',
  'ORTHODONTICS',
  'PEDIATRIC_SPECIAL_CARE',
  'ORAL_MEDICINE',
  'IMAGING_DIGITAL',
] as const

export type KnowledgeDomain = (typeof KNOWLEDGE_DOMAINS)[number]

/** Subtopics per domain (controlled vocabulary, spec §4). */
export const TAXONOMY_SUBTOPICS: Record<KnowledgeDomain, readonly string[]> = {
  FOUNDATIONAL: [
    'oral-anatomy', 'head-neck-anatomy', 'oral-histology', 'oral-physiology', 'dental-materials',
  ],
  DIAGNOSIS: [
    'dental-diagnosis', 'differential-diagnosis', 'oral-examination',
    'clinical-decision-support', 'oral-pathology', 'general-pathology',
  ],
  RESTORATIVE: [
    'operative-dentistry', 'restorative-dentistry', 'cariology', 'dental-caries',
    'adhesive-dentistry', 'composite-restorations', 'amalgam', 'glass-ionomer',
    'minimal-intervention',
  ],
  ENDODONTICS: [
    'pulp-diagnosis', 'periapical-diagnosis', 'root-canal-treatment', 'retreatment',
    'complications', 'emergencies', 'dental-trauma', 'apexogenesis',
    'regenerative-endodontics',
  ],
  PERIODONTOLOGY: [
    'gingivitis', 'periodontitis', 'periodontal-diagnosis', 'periodontal-treatment-planning',
    'non-surgical-therapy', 'periodontal-surgery', 'regeneration', 'peri-implant-diseases',
    'oral-hygiene',
  ],
  PROSTHODONTICS: [
    'fixed-prosthodontics', 'crowns', 'bridges', 'veneers', 'inlays-onlays',
    'removable-prosthodontics', 'complete-dentures', 'partial-dentures', 'occlusion',
  ],
  IMPLANTOLOGY: [
    'implant-planning', 'implant-complications', 'bone-grafting', 'sinus-lift',
  ],
  SURGERY: [
    'extractions', 'impacted-teeth', 'minor-oral-surgery', 'surgical-complications',
  ],
  ORTHODONTICS: [
    'malocclusion', 'cephalometrics', 'orthodontic-diagnosis', 'orthodontic-treatment-planning',
    'fixed-appliances', 'clear-aligners', 'retention', 'orthognathic-concepts',
    'orthodontic-emergencies',
  ],
  PEDIATRIC_SPECIAL_CARE: [
    'child-development', 'primary-teeth', 'mixed-dentition', 'pediatric-caries',
    'preventive-dentistry', 'fluoride', 'sealants', 'special-care', 'geriatric',
  ],
  ORAL_MEDICINE: [
    'oral-mucosal-diseases', 'oral-ulcers', 'oral-infections', 'oral-cysts', 'oral-tumors',
    'oral-cancer', 'salivary-gland-disorders', 'tmj-disorders', 'orofacial-pain',
  ],
  IMAGING_DIGITAL: [
    'dental-radiology', 'panoramic-imaging', 'intraoral-radiography', 'cbct',
    'dental-photography', 'digital-dentistry', 'cad-cam', '3d-dental-imaging',
    '3d-dental-analysis', 'ai-in-dentistry',
  ],
}

export const DOMAIN_LABELS: Record<KnowledgeDomain, string> = {
  FOUNDATIONAL: 'Foundational dental science',
  DIAGNOSIS: 'Dental diagnosis & examination',
  RESTORATIVE: 'Restorative dentistry & cariology',
  ENDODONTICS: 'Endodontics',
  PERIODONTOLOGY: 'Periodontology',
  PROSTHODONTICS: 'Prosthodontics',
  IMPLANTOLOGY: 'Implantology',
  SURGERY: 'Oral surgery',
  ORTHODONTICS: 'Orthodontics',
  PEDIATRIC_SPECIAL_CARE: 'Pediatric & special care dentistry',
  ORAL_MEDICINE: 'Oral medicine',
  IMAGING_DIGITAL: 'Imaging & digital dentistry',
}

export function isKnowledgeDomain(value: unknown): value is KnowledgeDomain {
  return typeof value === 'string' && (KNOWLEDGE_DOMAINS as readonly string[]).includes(value)
}

export function isSubtopic(domain: KnowledgeDomain, value: unknown): value is string {
  return typeof value === 'string' && TAXONOMY_SUBTOPICS[domain].includes(value)
}

/**
 * Curated surface terms (EN + AR) that deterministically signal a domain.
 * Used for document domain classification and query domain detection.
 * Only well-established dental terminology — no invented mappings.
 */
const DOMAIN_TERMS: Record<KnowledgeDomain, readonly string[]> = {
  FOUNDATIONAL: [
    'anatomy', 'histology', 'physiology', 'enamel', 'dentin', 'cementum', 'periodontal ligament',
    'الدقة التشريحية', 'تشريح', 'نسيج', 'ENAMEL', 'MOLAR', 'premolar', 'incisor', 'canine',
  ],
  DIAGNOSIS: [
    'diagnosis', 'diagnostic', 'differential', 'examination', 'examination findings',
    'clinical decision', 'pathology', 'lesion', 'symptom', 'signs', 'shading', 'vitality',
    'تشخيص', 'فحص', 'أعراض', 'علامات',
  ],
  RESTORATIVE: [
    'restoration', 'restorative', 'restorations', 'filling', 'fillings', 'caries', 'cavity',
    'carious', 'composite', 'amalgam', 'glass ionomer', 'gic', 'adhesive', 'etch', 'bonding',
    'occlusal', 'minimal intervention', 'cariology',
    'حشو', 'حشوة', 'تسوس', 'كومبوزيت', 'املغم', 'زئبق',
  ],
  ENDODONTICS: [
    'endodontic', 'endodontics', 'endodontically', 'pulp', 'pulpitis', 'pulpal', 'root canal',
    'periradicular', 'periapical', 'apex', 'apexogenesis', 'regenerative endo', 'retreatment',
    'irrigation', 'obturation', 'gutta-percha', 'trauma',
    'عصب السن', 'نخاع السن', 'قناة الجذر', 'التهاب العصب',
  ],
  PERIODONTOLOGY: [
    'periodontal', 'periodontitis', 'gingivitis', 'gingiva', 'gum', 'gums', 'probing depth',
    'bone loss', 'attachment loss', 'scaling', 'root planing', 'halitosis', 'periodont',
    'peri-implant', 'oral hygiene', 'plaque', 'calculus',
    'التهاب اللثة', 'اللثة', 'نزيف اللثة', 'نظافة الفم', 'البلاك',
  ],
  PROSTHODONTICS: [
    'crown', 'crowns', 'bridge', 'bridges', 'veneer', 'veneers', 'inlay', 'onlay', 'denture',
    'dentures', 'implant-supported', 'occlusion', 'occlusal scheme', 'fixed prosthesis',
    'removable prosthesis', 'partial denture', 'complete denture', 'prosthodont',
    'تاج', 'جسر', 'طقم', 'أطقم', 'فينير',
  ],
  IMPLANTOLOGY: [
    'implant', 'implants', 'implantology', 'osseointegration', 'bone graft', 'bone grafting',
    'sinus lift', 'abutment', 'implant planning',
    'زراعة', 'زراعة الأسنان', 'ترميم العظم', 'رفع الجيب',
  ],
  SURGERY: [
    'surgery', 'surgical', 'extraction', 'extractions', 'extracted', 'impacted', 'wisdom tooth',
    'wisdom teeth', 'flap', 'suturing', 'suture', 'hemostasis',
    'سحب', 'قلع', 'خلع', 'سن العقل', 'جرحة', 'جراحة',
  ],
  ORTHODONTICS: [
    'orthodontic', 'orthodontics', 'orthodontist', 'malocclusion', 'cephalometric', 'braces',
    'fixed appliance', 'clear aligner', 'aligners', 'retainer', 'retention', 'expander',
    'orthognathic', 'space maintenance', 'crowding',
    'تقويم', 'تقويم الأسنان', 'مشكلة في الفك',
  ],
  PEDIATRIC_SPECIAL_CARE: [
    'pediatric', 'pediatric dentistry', 'child', 'children', 'infant', 'primary teeth',
    'deciduous', 'baby teeth', 'mixed dentition', 'fluoride', 'sealant', 'sealants',
    'prevention', 'preventive', 'special care', 'geriatric', 'elderly', 'autism',
    'طفولي', 'أطفال', 'رضاعة', 'الفلوريد', 'عزل', 'وقاية',
  ],
  ORAL_MEDICINE: [
    'oral ulcer', 'ulcer', 'ulcers', 'mucosal', 'stomatitis', 'aphthous', 'candidiasis',
    'cyst', 'cysts', 'tumor', 'tumors', 'neoplasm', 'oral cancer', 'salivary', 'parotid',
    'dry mouth', 'xerostomia', 'tmj', 'temporomandibular', 'orofacial pain', 'trigeminal',
    'نقر', 'قرحة', 'كتلة', 'ورم', 'سرطان الفم', 'اللعاب', 'مفصل الفك',
  ],
  IMAGING_DIGITAL: [
    'radiograph', 'radiography', 'radiographic', 'x-ray', 'xray', 'bitewing', 'panoramic',
    'panorex', 'cbct', 'cone beam', 'cephalogram', 'periapical radiograph', 'digital dentistry',
    'cad/cam', 'cad cam', '3d printing', 'intraoral scan', 'photography', 'ai in dentistry',
    'الأشعة', 'اشعة', 'بانورامي', 'تصوير',
  ],
}

/** Deterministic domain scoring: highest keyword-hit domain wins. */
export function detectDomains(
  text: string,
  minHits = 1
): Array<{ domain: KnowledgeDomain; hits: number }> {
  const lower = text.toLowerCase()
  const results: Array<{ domain: KnowledgeDomain; hits: number }> = []
  for (const domain of KNOWLEDGE_DOMAINS) {
    let hits = 0
    for (const term of DOMAIN_TERMS[domain]) {
      // Arabic terms: direct substring (no word boundaries needed); Latin: boundary-safe.
      if (/[\u0600-\u06FF]/.test(term)) {
        if (lower.includes(term)) hits += 1
      } else if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\/\-]/g, '\\$&')}\\b`, 'i').test(lower)) {
        hits += 1
      }
    }
    if (hits >= minHits) results.push({ domain, hits })
  }
  return results.sort((a, b) => b.hits - a.hits || a.domain.localeCompare(b.domain))
}

export function primaryDomain(text: string): KnowledgeDomain | null {
  const found = detectDomains(text)
  return found.length ? found[0].domain : null
}
