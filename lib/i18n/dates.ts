/**
 * date-fns locale binding.
 *
 * date-fns needs an explicit locale object to render month and weekday names;
 * without one it always formats in English. The app's locale values are the
 * same tags `Intl` understands (`ar-EG`, `en-EG`, `en-US`), so the only mapping
 * needed is "Arabic UI → date-fns `ar`", everything else keeps the default
 * English locale.
 */
import { ar } from 'date-fns/locale'

export function dateFnsLocale(locale: string | null | undefined) {
  return locale && locale.startsWith('ar') ? ar : undefined
}
