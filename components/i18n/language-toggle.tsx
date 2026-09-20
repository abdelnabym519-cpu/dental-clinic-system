'use client'

import { Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/components/providers/language-provider'
import { cn } from '@/lib/utils'

/**
 * Compact Arabic ⇄ English switch. Persists the choice in the `dentora-locale`
 * cookie (read by the root layout to set `<html lang dir>`) and flips the
 * live document immediately.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLanguage()

  return (
    <div
      className={cn('inline-flex items-center gap-1 rounded-md border p-1', className)}
      role="group"
      aria-label={t('common.language')}
    >
      <Languages className="mx-1 h-4 w-4 text-muted-foreground" aria-hidden />
      <Button
        type="button"
        variant={locale === 'ar-EG' ? 'default' : 'ghost'}
        size="sm"
        className="h-7 px-2 text-xs"
        aria-pressed={locale === 'ar-EG'}
        onClick={() => setLocale('ar-EG')}
      >
        العربية
      </Button>
      <Button
        type="button"
        variant={locale.startsWith('en') ? 'default' : 'ghost'}
        size="sm"
        className="h-7 px-2 text-xs"
        aria-pressed={locale.startsWith('en')}
        onClick={() => setLocale('en-EG')}
      >
        English
      </Button>
    </div>
  )
}
