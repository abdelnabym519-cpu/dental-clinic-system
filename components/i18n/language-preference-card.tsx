'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Languages, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { resolveLocaleCascade } from '@/lib/i18n/config'
import { formatCurrency, formatDate } from '@/lib/i18n/format'

/**
 * `<SelectItem value="">` is not allowed, so "inherit" stands in for the empty
 * choice in the widget and is sent to the API as `null`.
 */
const INHERIT = 'inherit'

interface LanguagePreferenceCardProps {
  /** The person's stored override. `null` means inherit from the clinic. */
  locale: string | null
  /** The clinic's locale, shown so "use clinic default" is not a mystery. */
  hospitalLocale: string | null
  /**
   * The clinic's ISO 4217 currency. A personal language choice changes how
   * amounts are *grouped and punctuated*, never which currency the clinic
   * bills in, and the preview has to show that honestly.
   */
  currency: string
  supportedLocales: readonly string[]
  /** Endpoint accepting `PATCH { locale: string | null }`. */
  endpoint: string
  /** Optional override; defaults to the localized settings description. */
  description?: string
}

export function LanguagePreferenceCard({
  locale,
  hospitalLocale,
  currency,
  supportedLocales,
  endpoint,
  description,
}: LanguagePreferenceCardProps) {
  const { t } = useLanguage()
  const router = useRouter()
  const { toast } = useToast()

  /**
   * Language names are shown in the language currently selected — Arabic mode
   * reads "العربية (مصر)" / "الإنجليزية", English mode "Arabic (Egypt)" /
   * "English". `Intl.DisplayNames` is deliberately not used: it depends on the
   * runtime's ICU data, so the same build could render differently per host.
   */
  const localeName = (value: string): string =>
    value.startsWith('ar')
      ? `${t('language.arabic')} (${t('language.egypt')})`
      : t('language.english')

  const [selected, setSelected] = useState(locale ?? INHERIT)
  const [saving, setSaving] = useState(false)

  const effective = resolveLocaleCascade(selected === INHERIT ? null : selected, hospitalLocale)
  const dirty = selected !== (locale ?? INHERIT)

  const handleSave = async () => {
    setSaving(true)
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: selected === INHERIT ? null : selected }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || t('Failed to save language'))
      }

      toast({
        title: t('toast.languageUpdated'),
        description:
          selected === INHERIT
            ? t('toast.followingClinicDefault')
            : t('toast.formattingUpdated', { language: localeName(selected) }),
      })

      // Mirror the choice into the locale cookie and the live document so
      // <html lang dir> (rendered from the cookie by the root layout) flips
      // immediately, then let the server components re-render.
      const chosen = selected === INHERIT ? hospitalLocale || 'ar-EG' : selected
      document.cookie = `dentora-locale=${encodeURIComponent(chosen)}; path=/; max-age=31536000; samesite=lax`
      document.documentElement.lang = chosen
      document.documentElement.dir = chosen.startsWith('ar') ? 'rtl' : 'ltr'
      router.refresh()
    } catch (error) {
      toast({
        title: t('toast.error'),
        description: error instanceof Error ? error.message : t('Failed to save language'),
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="h-5 w-5" />
          {t('profile.languageFormatting')}
        </CardTitle>
        <CardDescription>{description ?? t('profile.languageDescription')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="locale">{t('profile.languageLabel')}</Label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger id="locale" className="max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT}>
                {t('language.clinicDefault')}
                {hospitalLocale ? ` (${localeName(hospitalLocale)})` : ''}
              </SelectItem>
              {supportedLocales.map((value) => (
                <SelectItem key={value} value={value}>
                  {localeName(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">{t('profile.languageNote')}</p>
        </div>

        <div className="rounded-md border p-4">
          <p className="text-sm font-medium">{t('ui.preview')}</p>
          <dl className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            <div className="flex gap-2">
              <dt>{t('ui.amount')}</dt>
              <dd className="font-medium text-foreground">
                {formatCurrency(125000.5, { locale: effective, currency })}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt>{t('ui.date')}</dt>
              <dd className="font-medium text-foreground">
                {formatDate(new Date(2026, 0, 31), { locale: effective })}
              </dd>
            </div>
          </dl>
        </div>
      </CardContent>

      <CardFooter>
        <Button onClick={handleSave} disabled={saving || !dirty}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('profile.save')}
        </Button>
      </CardFooter>
    </Card>
  )
}
