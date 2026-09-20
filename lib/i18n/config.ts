/**
 * Supported locales and their regional defaults.
 *
 * A clinic's locale lives on the Hospital record rather than in the URL: this
 * is a logged-in B2B app, so there is no need for `/[locale]/` segments and no
 * need to restructure every route under app/(dashboard).
 *
 * The product targets Egyptian dental clinics: Arabic (ar-EG, RTL) is the
 * primary locale, with Egyptian English (en-EG) and international English
 * (en-US) available. See docs/LOCALIZATION.md for the wider plan.
 */

export const locales = ['ar-EG', 'en-EG', 'en-US'] as const

export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'ar-EG'

export interface LocaleDefaults {
  /** ISO 4217 currency code. */
  currency: string
  /** ISO 3166-1 alpha-2. Selects the tax provider once that lands. */
  country: string
  /** IANA timezone. */
  timezone: string
}

export const localeDefaults: Record<Locale, LocaleDefaults> = {
  'ar-EG': { currency: 'EGP', country: 'EG', timezone: 'Africa/Cairo' },
  'en-EG': { currency: 'EGP', country: 'EG', timezone: 'Africa/Cairo' },
  'en-US': { currency: 'USD', country: 'US', timezone: 'America/New_York' },
}

/** Locales written right-to-left — drives `<html dir>` and layout mirroring. */
export const rtlLocales: readonly Locale[] = ['ar-EG']

export function isRTL(locale: string | null | undefined): boolean {
  return rtlLocales.includes(locale as Locale)
}

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return !!value && (locales as readonly string[]).includes(value)
}

/**
 * Narrow an arbitrary string to a supported locale, falling back to the
 * default. Use at every boundary where a locale arrives from the database or
 * a request, so a stale or hand-edited value can never break formatting.
 */
export function resolveLocale(value: string | null | undefined): Locale {
  return isSupportedLocale(value) ? value : defaultLocale
}

/**
 * Resolve a locale from an ordered list of candidates, most specific first.
 *
 * The first *supported* candidate wins. Anything null, undefined, empty or no
 * longer in `locales` is skipped rather than being treated as a choice, which
 * is what makes "null means inherit" work: a user with no preference falls
 * through to their clinic, and a clinic with none falls through to the default.
 *
 *   resolveLocaleCascade(user.locale, hospital.locale)  // staff
 *   resolveLocaleCascade(patient.locale, hospital.locale)  // portal
 *   resolveLocaleCascade(searchParams.lang, hospital.locale)  // public
 *
 * Note that an *unsupported* stored value also falls through rather than
 * dropping straight to `defaultLocale`. If a user picked `de-DE` while it was
 * supported and it later was not, they should see their clinic's locale, not
 * ar-EG. `resolveLocale(user.locale ?? hospital.locale)` would get this wrong,
 * which is why this exists as a separate function.
 */
export function resolveLocaleCascade(...candidates: (string | null | undefined)[]): Locale {
  for (const candidate of candidates) {
    if (isSupportedLocale(candidate)) return candidate
  }
  return defaultLocale
}

/**
 * Locale for a public page — payment links, and anything else reachable
 * without signing in.
 *
 * `?lang=` applies to **this request only and is never persisted**. There is no
 * account to store it against, and writing a visitor's query string to the
 * clinic record would let any link change what every other visitor sees.
 *
 * Pure by design: the caller has already loaded the clinic it is rendering, so
 * this must not go anywhere near the database or the session.
 */
export function resolvePublicLocale(
  hospitalLocale: string | null | undefined,
  langParam?: string | string[] | null
): Locale {
  // Next surfaces a repeated query parameter as an array; take the first.
  const requested = Array.isArray(langParam) ? langParam[0] : langParam
  return resolveLocaleCascade(requested, hospitalLocale)
}

export function getLocaleDefaults(value: string | null | undefined): LocaleDefaults {
  return localeDefaults[resolveLocale(value)]
}

/**
 * Human-readable name for a locale, e.g. `ar-EG` -> "العربية (مصر)".
 *
 * Derived from `Intl` rather than a hardcoded table so that adding a locale to
 * `locales` above is genuinely the only step. Falls back to the tag itself on
 * the older runtimes where `DisplayNames` is missing.
 */
export function getLocaleLabel(locale: string, displayIn = 'en'): string {
  try {
    // `languageDisplay: 'standard'` keeps the list internally consistent —
    // the default ('dialect') renders en-US as "American English".
    return (
      new Intl.DisplayNames([displayIn], {
        type: 'language',
        languageDisplay: 'standard',
      }).of(locale) ?? locale
    )
  } catch {
    return locale
  }
}
