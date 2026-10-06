/**
 * DenToRa — Interactive Dental Chart: localized clinical labels (Stage L).
 *
 * The i18n dictionary passes unknown keys through unchanged, so clinical
 * enums (DB ToothCondition values, surfaces) ship bilingual label maps here
 * while free-text UI strings go through locales/*.json `dental_chart.*`.
 * Arabic is primary (Arabic-first rule); English provided for LTR mode.
 */

export const CONDITION_LABELS: Record<string, { ar: string; en: string }> = {
  HEALTHY: { ar: 'سليم', en: 'Healthy' },
  CARIES: { ar: 'تسوس', en: 'Caries' },
  FILLED: { ar: 'محشو', en: 'Filled' },
  CROWN: { ar: 'تلبيس', en: 'Crown' },
  BRIDGE: { ar: 'جسر', en: 'Bridge' },
  IMPLANT: { ar: 'زراعة', en: 'Implant' },
  ROOT_CANAL: { ar: 'علاج عصب', en: 'Root canal' },
  EXTRACTION: { ar: 'مخلوع', en: 'Extracted' },
  MISSING: { ar: 'مفقود', en: 'Missing' },
  FRACTURED: { ar: 'مكسور', en: 'Fractured' },
  SENSITIVE: { ar: 'حساس', en: 'Sensitive' },
  MOBILITY: { ar: 'ارتخاء', en: 'Mobility' },
  ABSCESS: { ar: 'خراج', en: 'Abscess' },
  PERIODONTAL: { ar: 'لثة/داعمة', en: 'Periodontal' },
  EXTRACTION_NEEDED: { ar: 'يستوجب خلعًا', en: 'Extraction needed' },
  VENEER: { ar: 'فينير', en: 'Veneer' },
}

export const SURFACE_LABELS: Record<string, { ar: string; en: string }> = {
  mesial: { ar: 'الأنسي', en: 'Mesial' },
  distal: { ar: 'الوحشي', en: 'Distal' },
  occlusal: { ar: 'الإطباقي', en: 'Occlusal' },
  buccal: { ar: 'الوجّهي', en: 'Buccal' },
  lingual: { ar: 'اللساني', en: 'Lingual' },
}

export const SEVERITY_LABELS: Record<string, { ar: string; en: string }> = {
  MILD: { ar: 'خفيف', en: 'Mild' },
  MODERATE: { ar: 'متوسط', en: 'Moderate' },
  SEVERE: { ar: 'شديد', en: 'Severe' },
}

/** DB enum values acceptable by POST /api/dental-chart (client extras excluded). */
export const CHARTABLE_CONDITIONS = [
  'CARIES',
  'FILLED',
  'CROWN',
  'BRIDGE',
  'IMPLANT',
  'ROOT_CANAL',
  'EXTRACTION',
  'MISSING',
  'FRACTURED',
  'SENSITIVE',
  'MOBILITY',
  'ABSCESS',
  'PERIODONTAL',
] as const

export function conditionLabel(condition: string, locale: string): string {
  const entry = CONDITION_LABELS[condition]
  if (!entry) return condition
  return locale === 'ar' ? entry.ar : entry.en
}
