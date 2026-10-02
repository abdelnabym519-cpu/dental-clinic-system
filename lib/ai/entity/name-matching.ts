/**
 * Deterministic Arabic↔Latin first-name matching for entity resolution.
 *
 * Egyptian clinics routinely store patient records with LATIN names
 * ("Ahmed Ali") while doctors speak/typing in Arabic ("مواعيد المريض أحمد").
 * Without a bounded transliteration probe, an Arabic name hint can never
 * match a Latin-stored record and the request dies in clarification.
 *
 * This is a bounded dictionary of common Egyptian first-name renderings —
 * NOT open-ended machine transliteration, and NOT a guess: every candidate
 * produced through it still goes through the same exact → unique-contains
 * → ambiguous-clarify semantics as any other lookup. More than one match
 * still asks; nothing is ever silently chosen.
 */

/** Arabic first name → common Latin renderings used in Egyptian records. */
const AR_TO_LATIN: Record<string, string[]> = {
  'أحمد': ['ahmed', 'ahmad'],
  'احمد': ['ahmed', 'ahmad'],
  'محمد': ['mohamed', 'mohammed', 'muhammad', 'mohamad'],
  'محمود': ['mahmoud', 'mahmud'],
  'مصطفى': ['mostafa', 'moustafa', 'mustafa'],
  'سارة': ['sara', 'sarah'],
  'ساره': ['sara', 'sarah'],
  'عمر': ['omar'],
  'خالد': ['khaled', 'khalid'],
  'مريم': ['mariam', 'maryam', 'meriam'],
  'فاطمة': ['fatma', 'fatema', 'fattma'],
  'نورا': ['nora', 'noura'],
  'هناء': ['hana', 'hanaa'],
  'كريم': ['karim'],
  'يوسف': ['youssef', 'yousef', 'yusuf'],
  'دينا': ['dina'],
  'إبراهيم': ['ibrahim'],
  'ابراهيم': ['ibrahim'],
  'علي': ['ali'],
  'حسن': ['hassan', 'hasan'],
  'حسين': ['hussein', 'hussien', 'hossein'],
  'سامي': ['sami', 'sammy'],
  'عادل': ['adel', 'adil'],
  'فتحي': ['fathy', 'fathi'],
  'سيد': ['sayed', 'sedky'],
  'منى': ['mona', 'mouna'],
  'هدى': ['hoda', 'huda'],
  'ريم': ['reem', 'rim'],
  'أمل': ['amal'],
  'سلمى': ['salma'],
  'ماجد': ['maged', 'majed'],
  'طارق': ['tarek', 'tariq'],
  'عمرو': ['amr'],
  'أنس': ['anas'],
  'ليلى': ['laila', 'layla'],
  'جمال': ['gamal', 'jamal'],
  'نجلاء': ['naglaa', 'nagla'],
  'شيماء': ['shimaa', 'shaimaa'],
  'مروة': ['marwa'],
  'أيمن': ['ayman'],
  'ايمان': ['eman', 'iman'],
  'رمضان': ['ramadan'],
  'عبد الله': ['abdallah', 'abdullah'],
}

export interface NameMatchForms {
  /** Original hint as spoken/typed. */
  hint: string
  /** Lowercased Latin renderings to probe additionally (possibly empty). */
  latin: string[]
}

/**
 * Bounded lookup: exact Arabic dictionary key (after trimming) → Latin
 * renderings. Anything outside the dictionary yields no extra forms — the
 * existing matching semantics are untouched.
 */
export function latinFormsFor(hint: string | null | undefined): string[] {
  if (!hint) return []
  const key = hint.trim().replace(/\s+/g, ' ')
  return AR_TO_LATIN[key] ?? AR_TO_LATIN[key.toLowerCase()] ?? []
}

/**
 * True when a stored (lowercased) full name contains the Arabic hint OR any
 * of its known Latin renderings. Both sides must already be lowercase.
 */
export function nameContainsForm(storedLower: string, hintLower: string): boolean {
  if (storedLower.includes(hintLower)) return true
  const forms = [hintLower, ...hintLower.split(/\s+/)]
  return forms.some((h) => latinFormsFor(h).some((f) => storedLower.includes(f)))
}
