/**
 * Bilingual dictionary (Arabic ⇄ English) and the translation helper.
 *
 * Keys are stable dotted identifiers (see locales/*.json). `t()` misses return
 * the key's last-resort fallback so a missing translation can never render an
 * empty label. English strings are kept in en.json so both UIs stay in sync.
 */
import ar from '../../locales/ar.json'
import en from '../../locales/en.json'
import { isRTL, resolveLocale, type Locale } from './config'

type Dictionary = Record<string, string>

export const dictionaries: Record<Locale, Dictionary> = {
  'ar-EG': ar as Dictionary,
  'en-EG': en as Dictionary,
  'en-US': en as Dictionary,
}

export type TranslationKey = keyof typeof ar | keyof typeof en

export function translate(
  locale: string | null | undefined,
  key: TranslationKey | string,
  vars?: Record<string, string | number>
): string {
  const dict = dictionaries[resolveLocale(locale)]
  // NOTE: the fallback is the key itself — never another dictionary object.
  // (A previous `dictionaries[resolveLocale(key)]` term resolved the unknown
  // key as a locale, handed back the WHOLE default dictionary, and made any
  // missing key render an object instead of a readable fallback.)
  const template = dict[key] ?? key
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  )
}

/** Direction for a locale — drives `<html dir>` and layout mirroring. */
export function directionFor(locale: string | null | undefined): 'rtl' | 'ltr' {
  return isRTL(resolveLocale(locale)) ? 'rtl' : 'ltr'
}

/**
 * Reverse index: English source string → dictionary key. Nav titles and other
 * UI strings live in components as their English text; this lets any call site
 * translate an existing English label without threading new ids around.
 */
let reverseIndex: Map<string, string> | null = null
function getReverseIndex(): Map<string, string> {
  if (!reverseIndex) {
    reverseIndex = new Map()
    for (const [key, value] of Object.entries(dictionaries['en-US'])) {
      if (!(reverseIndex as Map<string, string>).has(value)) reverseIndex.set(value, key)
    }
  }
  return reverseIndex
}

/**
 * Translate UI text.
 *
 * Three-step resolution, most specific first:
 *
 *   1. Exact dictionary key (`ui.save`, `nav.patients`) — the wired convention.
 *   2. An existing English UI label ("Save", "Patients") — resolved through the
 *      reverse index, so a label that lives in a config array or a text node
 *      does not need a new id threaded to it.
 *   3. The text itself — an unknown string renders unchanged rather than as a
 *      bare key, so nothing can ever disappear from the UI.
 */
export function translateText(
  locale: string | null | undefined,
  text: string,
  vars?: Record<string, string | number>
): string {
  if (text in dictionaries[resolveLocale(locale)]) return translate(locale, text, vars)
  const key = getReverseIndex().get(text)
  return key ? translate(locale, key, vars) : text
}

/** Translate an existing English UI label (e.g. a nav item title). */
export function translateLabel(
  locale: string | null | undefined,
  englishLabel: string,
  vars?: Record<string, string | number>
): string {
  return translateText(locale, englishLabel, vars)
}

