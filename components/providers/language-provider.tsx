'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { defaultLocale, LOCALE_COOKIE, resolveLocale, type Locale } from '@/lib/i18n/config'
import { directionFor, translateText } from '@/lib/i18n/dictionary'

// Re-exported so existing imports (`app/layout.tsx`, tests) keep working; the
// canonical definition now lives in lib/i18n/config.
export { LOCALE_COOKIE }

/**
 * Client-side language context.
 *
 * The chosen locale is persisted in a cookie (`dentora-locale`) so the server
 * can render `<html lang dir>` correctly on the next request, and mirrored
 * onto `document.documentElement` immediately so switching never flashes the
 * wrong direction. The user's stored `User.locale` (database preference set in
 * Settings → Profile) seeds the cookie server-side; the selector here updates
 * both the cookie and the live document.
 */
interface LanguageContextValue {
  locale: Locale
  dir: 'rtl' | 'ltr'
  t: (key: string, vars?: Record<string, string | number>) => string
  setLocale: (locale: string) => void
}

const LanguageContext = createContext<LanguageContextValue>({
  locale: defaultLocale,
  dir: directionFor(defaultLocale),
  // Default resolution goes through the ENGLISH dictionary, not the raw key:
  // components rendered outside a LanguageProvider (legacy tests, partial
  // mounts) keep showing the exact English strings they always showed.
  t: (key, vars) => translateText('en-EG', key, vars),
  setLocale: () => {},
})

export function LanguageProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode
  initialLocale?: string | null
}) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    resolveLocale(initialLocale ?? defaultLocale)
  )

  useEffect(() => {
    const cookieLocale = document.cookie
      .split('; ')
      .find((row) => row.startsWith(`${LOCALE_COOKIE}=`))
      ?.split('=')[1]
    if (cookieLocale) setLocaleState(resolveLocale(decodeURIComponent(cookieLocale)))
  }, [])

  const apply = useCallback((next: Locale) => {
    setLocaleState(next)
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=31536000; samesite=lax`
    document.documentElement.lang = next
    document.documentElement.dir = directionFor(next)
  }, [])

  // Keep <html> in sync if the locale was set server-side after mount.
  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = directionFor(locale)
  }, [locale])

  const setLocale = useCallback((next: string) => apply(resolveLocale(next)), [apply])

  const value = useMemo<LanguageContextValue>(
    () => ({
      locale,
      dir: directionFor(locale),
      t: (key, vars) => translateText(locale, key, vars),
      setLocale,
    }),
    [locale, setLocale]
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext)
}
