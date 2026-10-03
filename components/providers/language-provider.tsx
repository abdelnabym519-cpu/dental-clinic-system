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
  // ISSUE 6 — Arabic-only product: the UI locale is ALWAYS the Arabic
  // default. initialLocale (stored User.locale) and the locale cookie are
  // read for compatibility but can no longer switch the UI; setLocale is a
  // compatibility no-op. The English dictionaries remain in the codebase
  // (translation architecture preserved) but are unreachable from the product.
  void initialLocale
  const [locale, setLocaleState] = useState<Locale>(() => defaultLocale)

  useEffect(() => {
    // Keep the cookie aligned with the frozen locale (stale 'en' cookies
    // heal on first visit instead of resurfacing later).
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(defaultLocale)}; path=/; max-age=31536000; samesite=lax`
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

  // ISSUE 6 — Arabic-only: switching is disabled; kept as a no-op so
  // existing call sites (and any future re-enable) keep compiling.
  const setLocale = useCallback(() => {
    apply(defaultLocale)
  }, [apply])

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
