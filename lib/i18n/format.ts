/**
 * The single locale-aware formatting module.
 *
 * Before this existed there were three near-duplicate `formatCurrency`
 * implementations (lib/utils.ts, lib/billing-utils.ts, lib/treatment-utils.ts),
 * each hardcoding `en-EG` and `EGP` with slightly different fraction-digit
 * rules. Those modules now delegate here and keep their own defaults, so
 * behaviour is unchanged while there is finally one place to add a locale.
 *
 * See docs/LOCALIZATION.md.
 */
import { defaultLocale, getLocaleDefaults, resolveLocale } from './config'
import { translateText } from './dictionary'

export interface CurrencyFormatOptions {
  locale?: string
  /** ISO 4217. Defaults to the locale's currency (EGP for ar-EG). */
  currency?: string
  minimumFractionDigits?: number
  maximumFractionDigits?: number
  /** Returned when the input is null, undefined or unparseable. */
  fallback?: string
}

export interface DateFormatOptions extends Intl.DateTimeFormatOptions {
  locale?: string
  /** Returned when the input is missing or not a valid date. */
  fallback?: string
}

function toNumber(amount: number | string | null | undefined): number | null {
  if (amount === null || amount === undefined || amount === '') return null
  const value = typeof amount === 'string' ? parseFloat(amount) : amount
  return Number.isNaN(value) ? null : value
}

function toDate(date: Date | string | number | null | undefined): Date | null {
  if (date === null || date === undefined || date === '') return null
  const value = date instanceof Date ? date : new Date(date)
  return Number.isNaN(value.getTime()) ? null : value
}

/**
 * Format a monetary amount. Note that digit grouping is locale-specific, not
 * just the symbol/order: ar-EG renders Eastern Arabic digits, en-EG `EGP 1,000.00`.
 */
export function formatCurrency(
  amount: number | string | null | undefined,
  options: CurrencyFormatOptions = {}
): string {
  const locale = resolveLocale(options.locale)
  const currency = options.currency ?? getLocaleDefaults(locale).currency
  const {
    minimumFractionDigits = 0,
    maximumFractionDigits = 2,
    // Format the fallback rather than hardcoding a symbol, so a non-EGP
    // clinic does not get a stray currency sign on empty values.
    fallback = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(0),
  } = options

  const value = toNumber(amount)
  if (value === null) return fallback

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value)
}

/** Format a plain number (no currency symbol) with locale digit grouping. */
export function formatNumber(
  value: number | string | null | undefined,
  options: { locale?: string; fallback?: string } & Intl.NumberFormatOptions = {}
): string {
  const { locale, fallback = '-', ...numberFormatOptions } = options
  const parsed = toNumber(value)
  if (parsed === null) return fallback
  return new Intl.NumberFormat(resolveLocale(locale), numberFormatOptions).format(parsed)
}

const DATE_DEFAULTS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
}

export function formatDate(
  date: Date | string | number | null | undefined,
  options: DateFormatOptions = {}
): string {
  const { locale, fallback = '-', ...dateTimeOptions } = options
  const value = toDate(date)
  if (value === null) return fallback

  return new Intl.DateTimeFormat(resolveLocale(locale), {
    ...DATE_DEFAULTS,
    ...dateTimeOptions,
  }).format(value)
}

export function formatDateTime(
  date: Date | string | number | null | undefined,
  options: DateFormatOptions = {}
): string {
  const { locale, fallback = '-', ...dateTimeOptions } = options
  const value = toDate(date)
  if (value === null) return fallback

  return new Intl.DateTimeFormat(resolveLocale(locale), {
    ...DATE_DEFAULTS,
    hour: '2-digit',
    minute: '2-digit',
    ...dateTimeOptions,
  }).format(value)
}

/**
 * Build a set of formatters bound to one clinic's locale, so call sites in a
 * request handler do not have to thread the locale through every call.
 */
export function createFormatters(locale: string | null | undefined = defaultLocale) {
  const resolved = resolveLocale(locale)
  const { currency } = getLocaleDefaults(resolved)

  return {
    locale: resolved,
    currency,
    formatCurrency: (amount: number | string | null | undefined, o: CurrencyFormatOptions = {}) =>
      formatCurrency(amount, { locale: resolved, currency, ...o }),
    formatNumber: (value: number | string | null | undefined, o: Intl.NumberFormatOptions = {}) =>
      formatNumber(value, { locale: resolved, ...o }),
    formatDate: (date: Date | string | number | null | undefined, o: DateFormatOptions = {}) =>
      formatDate(date, { locale: resolved, ...o }),
    formatDateTime: (date: Date | string | number | null | undefined, o: DateFormatOptions = {}) =>
      formatDateTime(date, { locale: resolved, ...o }),
  }
}

/**
 * Relative time ("just now", "5m ago", "3d ago") for feeds, trays and status
 * columns — the single implementation for the whole app.
 *
 * It used to exist twice, both copies hardcoded English: the notification tray
 * and the device list. The unit letters are part of the localized pattern
 * (`{v1}m ago`), not concatenated, so Arabic reads naturally ("قبل 5 د").
 */
export function formatRelativeTime(
  date: Date | string | number | null | undefined,
  options: { locale?: string; fallback?: string } = {}
): string {
  const { locale, fallback = '' } = options
  const value = toDate(date)
  if (value === null) return fallback

  const diffSeconds = Math.floor((Date.now() - value.getTime()) / 1000)
  if (diffSeconds < 0) return formatDate(value, { locale, fallback })

  const translated = (key: string, vars?: Record<string, string | number>) =>
    translateText(locale, key, vars)

  if (diffSeconds < 60) return translated('just now')
  if (diffSeconds < 3600) return translated('{v1}m ago', { v1: Math.floor(diffSeconds / 60) })
  if (diffSeconds < 86400) return translated('{v1}h ago', { v1: Math.floor(diffSeconds / 3600) })
  if (diffSeconds < 604800) return translated('{v1}d ago', { v1: Math.floor(diffSeconds / 86400) })
  return formatDate(value, { locale, fallback })
}
