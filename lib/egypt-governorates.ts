/**
 * Egypt's 27 governorates (محافظات مصر), Arabic (official) with English labels.
 *
 * Used as datalist suggestions for address "state/governorate" fields —
 * free-text is still accepted so historical and informal entries keep working.
 */

export interface Governorate {
  /** Official Arabic name — the stored/entered value. */
  value: string
  /** English name — displayed as the datalist hint. */
  label: string
}

export const EGYPT_GOVERNORATES: Governorate[] = [
  { value: 'القاهرة', label: 'Cairo' },
  { value: 'الجيزة', label: 'Giza' },
  { value: 'الإسكندرية', label: 'Alexandria' },
  { value: 'القليوبية', label: 'Qalyubia' },
  { value: 'بورسعيد', label: 'Port Said' },
  { value: 'السويس', label: 'Suez' },
  { value: 'الإسماعيلية', label: 'Ismailia' },
  { value: 'دمياط', label: 'Damietta' },
  { value: 'الشرقية', label: 'Sharqia' },
  { value: 'الدقهلية', label: 'Dakahlia' },
  { value: 'الغربية', label: 'Gharbia' },
  { value: 'المنوفية', label: 'Monufia' },
  { value: 'البحيرة', label: 'Beheira' },
  { value: 'كفر الشيخ', label: 'Kafr El Sheikh' },
  { value: 'الفيوم', label: 'Fayoum' },
  { value: 'بني سويف', label: 'Beni Suef' },
  { value: 'المنيا', label: 'Minya' },
  { value: 'أسيوط', label: 'Assiut' },
  { value: 'سوهاج', label: 'Sohag' },
  { value: 'قنا', label: 'Qena' },
  { value: 'الأقصر', label: 'Luxor' },
  { value: 'أسوان', label: 'Aswan' },
  { value: 'البحر الأحمر', label: 'Red Sea' },
  { value: 'مطروح', label: 'Matrouh' },
  { value: 'شمال سيناء', label: 'North Sinai' },
  { value: 'جنوب سيناء', label: 'South Sinai' },
  { value: 'الوادي الجديد', label: 'New Valley' },
]

/** Chief-complaint examples for booking/scheduling inputs (Egyptian clinic phrasing). */
export const CHIEF_COMPLAINT_EXAMPLES = [
  'ألم في الأسنان — أعلى يمين',
  'تسوس — الضرس الخلفي',
  'تنظيف أسنان دوري',
  'تركيب طقم أسنان',
  'ألم في اللثة',
]

/** Bilingual hint appended to chief-complaint placeholders. */
export const COMPLAINT_HINT =
  '— مثال: ألم في الأسنان — أعلى يمين، تسوس — الضرس الخلفي، تنظيف أسنان دوري، تركيب طقم أسنان، ألم في اللثة'
