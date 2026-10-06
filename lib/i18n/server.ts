/**
 * Server-side translation helpers.
 *
 * Server components cannot call `useLanguage()`, so they resolve the locale the
 * same way the root layout does — from the `dentora-locale` cookie — and then
 * use the shared dictionary. Keeping this in one place means a server-rendered
 * page and a client component always agree on the language.
 */
import { cookies } from 'next/headers'

import { defaultLocale, LOCALE_COOKIE, resolveLocale, type Locale } from './config'
import { translateText } from './dictionary'

/** Locale for the current request, from the cookie, falling back to default. */
export async function getServerLocale(): Promise<Locale> {
  try {
    return resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value)
  } catch {
    // Static rendering / no request scope — never fail a page over a label.
    return defaultLocale
  }
}

/** `t()` for server components: keys and English labels both resolve. */
export async function getServerTranslator(): Promise<{
  locale: Locale
  t: (text: string, vars?: Record<string, string | number>) => string
}> {
  const locale = await getServerLocale()
  return { locale, t: (text, vars) => translateText(locale, text, vars) }
}
