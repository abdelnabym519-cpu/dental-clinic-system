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

/**
 * Bounded Arabic SURNAME renderings used in Egyptian records (the spoken
 * family name often reaches the record in Latin). Same class as the
 * first-name dictionary — bounded renderings, never open transliteration;
 * the DB still decides, uniqueness and ambiguity rules unchanged.
 */
const AR_SURNAME_TO_LATIN: Record<string, string[]> = {
  'النبي': ['alnaby', 'alnabi', 'elnaby', 'elnabi', 'naby', 'nabi'],
  'سعيد': ['said', 'saeed', 'sayed', 'saeed'],
  'سالم': ['salem', 'salim'],
  'حسن': ['hassan', 'hasan', 'hassen'],
  'حسين': ['hussein', 'hussien', 'hussin'],
  'شعبان': ['shaaban', 'shaban', 'shaaban'],
  'عبد الله': ['abdallah', 'abdullah', 'abdalla'],
  'فتحي': ['fathy', 'fathi'],
  'إبراهيم': ['ibrahim', 'ibrahim'],
  'مصطفى': ['mostafa', 'mustafa', 'moustafa'],
  'السيد': ['elsayed', 'elsaid', 'elsyed', 'alsayed'],
  'محمد': ['mohamed', 'mohammed', 'muhammad', 'mohamad'],
  'أحمد': ['ahmed', 'ahmad'],
  'علي': ['ali', 'aly'],
  'حسان': ['hassan', 'hasan'],
  'زكي': ['zaki'],
  'فتحى': ['fathy', 'fathi'],
  'رمضان': ['ramadan', 'ramadан'.replace('ан', 'an')],
  'طلعت': ['talat', 'talaat'],
  'صفوت': ['safwat', 'safouat'],
  'سليمان': ['soliman', 'suleiman', 'suliman'],
  'عوض': ['awad', 'ewida'],
  'الشريف': ['elsherif', 'alsherif', 'sherif'],
  'الديب': ['eldeeb', 'eldeib', 'deeb'],
  'غالي': ['ghaly', 'ghali'],
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
  return AR_TO_LATIN[key] ?? AR_TO_LATIN[key.toLowerCase()] ?? AR_SURNAME_TO_LATIN[key] ?? AR_SURNAME_TO_LATIN[key.toLowerCase()] ?? []
}

/** Hamza/ta-marbuta/alef-maksura folding so 'أحمد'/'احمد' compare equal. */
function foldAr(w: string): string {
  return w.replace(/[\u0623\u0625\u0622]/g, '\u0627').replace(/\u0629/g, '\u0647').replace(/\u0649/g, '\u064A')
}

/**
 * True when a stored (lowercased) full name matches the spoken/typed hint.
 * Both sides must already be lowercase.
 *
 * Single-word hints: substring OR any bounded Latin rendering ('أحمد' →
 * 'ahmed').
 *
 * MULTI-word hints are a FULL spoken name: EVERY spoken word must be
 * satisfied by some stored word (folded exact/substring, or a bounded
 * rendering). A partial overlap is a DIFFERENT person — two people share
 * single name parts ('محمد علي' must never ride 'محمد النبي' or 'Ahmed
 * Ali' on one shared word). A non-match stays a recoverable NOT_FOUND
 * clarification; the DB decides, never a guess.
 */
export function nameContainsForm(storedLower: string, hintLower: string): boolean {
  if (storedLower.includes(hintLower) || foldAr(storedLower).includes(foldAr(hintLower))) return true
  const hintWords = hintLower.split(/\s+/).filter(Boolean)
  if (hintWords.length <= 1) {
    return latinFormsFor(hintLower).some((f) => storedLower.includes(f))
  }
  const storedWords = foldAr(storedLower).split(/\s+/).filter(Boolean)
  const wordSatisfied = (w: string): boolean => {
    const fw = foldAr(w)
    if (storedWords.some((sw) => sw === fw || (sw.includes(fw) && fw.length >= 3) || (fw.includes(sw) && sw.length >= 3))) return true
    return latinFormsFor(w).some((f) => storedWords.some((sw) => sw === f || sw.includes(f)))
  }
  // 'عبد الله …' — the first TWO spoken words may be ONE stored first name.
  if (hintWords.length >= 2) {
    const compound = hintWords.slice(0, 2).join(' ')
    if (latinFormsFor(compound)?.length && storedLower.includes(latinFormsFor(compound)[0]!)) {
      return hintWords.slice(2).every(wordSatisfied)
    }
  }
  return hintWords.every(wordSatisfied)
}
