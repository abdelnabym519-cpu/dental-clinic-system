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
/**
 * Pattern index: parameterized keys → matcher for already-substituted sentences.
 *
 * Some strings reach the UI already interpolated, so they can never equal a key: an API
 * returns `Room is already booked by appointment INV-7 at 2026-01-05T09:30:00.000Z`,
 * and a client renders `data.error` straight into a toast. Rather than push a message-code
 * contract into every route, the cascade grows a third step - match the sentence against
 * the literal frame of a parameterized key, capture the values, and render that key's
 * template with them.
 *
 * Only unambiguous frames participate. A key qualifies when, with its placeholders
 * removed, the skeleton still has at least two words and 14 characters. That keeps
 * label-shaped keys (`Patient: {v1}`, `Total: {v1}`, `Chair {v1}`) out of the index:
 * free text must never be guessed into a UI label. Longest skeleton wins, so a specific
 * frame beats a looser one that could also match.
 */
type PatternEntry = { key: string; re: RegExp; names: string[]; weight: number }

let patternIndex: PatternEntry[] | null = null
const patternHits = new Map<string, string | null>()

function skeletonOf(key: string): string {
  return key.replace(/\{\w+\}/g, ' ').replace(/\s+/g, ' ').trim()
}

function escapeRe(part: string): string {
  return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
}

function getPatternIndex(): PatternEntry[] {
  if (patternIndex) return patternIndex
  patternIndex = []
  for (const key of Object.keys(en)) {
    if (!/\{\w+\}/.test(key)) continue
    const skeleton = skeletonOf(key)
    if (skeleton.length < 14 || skeleton.split(' ').length < 2) continue
    const names: string[] = []
    const source = key
      .split(/(\{\w+\})/)
      .map((piece) => {
        const m = /^\{(\w+)\}$/.exec(piece)
        if (!m) return escapeRe(piece)
        const name = m[1]
        // named groups must be unique per pattern; index the name to keep them so
        const group = `p${names.length}`
        names.push(name)
        return `(?<${group}>[^{}]+?)`
      })
      .join('')
    patternIndex.push({ key, re: new RegExp(`^${source}$`), names, weight: skeleton.length })
  }
  patternIndex.sort((a, b) => b.weight - a.weight)
  return patternIndex
}

/** Match an already-interpolated sentence back to its key, or null. Exported for tests. */
export function matchParameterizedKey(text: string): { key: string; vars: Record<string, string> } | null {
  const trimmed = text.trim()
  if (trimmed.length < 16 || !trimmed.includes(' ')) return null
  if (patternHits.has(trimmed)) {
    const cached = patternHits.get(trimmed)
    if (!cached) return null
    // cache stores only the key; re-derive vars (cheap, avoids unbounded value growth)
    return extract(trimmed, cached)
  }
  const found = getPatternIndex().find((entry) => entry.re.test(trimmed))
  patternHits.set(trimmed, found ? found.key : null)
  if (patternHits.size > 2000) patternHits.clear()
  return found ? extract(trimmed, found.key) : null
}

function extract(text: string, key: string): { key: string; vars: Record<string, string> } | null {
  const entry = getPatternIndex().find((e) => e.key === key)
  if (!entry) return null
  const m = entry.re.exec(text)
  if (!m || !m.groups) return null
  const vars: Record<string, string> = {}
  entry.names.forEach((name, i) => {
    vars[name] = m.groups![`p${i}`] ?? ''
  })
  return { key, vars }
}

export function translateText(
  locale: string | null | undefined,
  text: string,
  vars?: Record<string, string | number>
): string {
  if (text in dictionaries[resolveLocale(locale)]) return translate(locale, text, vars)
  const key = getReverseIndex().get(text)
  if (key) return translate(locale, key, vars)
  // server-shaped copy that arrived already interpolated: `Failed to fetch patient (503)`
  const matched = vars ? null : matchParameterizedKey(text)
  if (matched) return translate(locale, matched.key, matched.vars)
  return text
}

/** Translate an existing English UI label (e.g. a nav item title). */
export function translateLabel(
  locale: string | null | undefined,
  englishLabel: string,
  vars?: Record<string, string | number>
): string {
  return translateText(locale, englishLabel, vars)
}

