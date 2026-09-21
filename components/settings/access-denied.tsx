import Link from 'next/link'
import { Home, ShieldAlert, User } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useLanguage } from '@/components/providers/language-provider'

/**
 * Forbidden screen for the settings area (HTTP 403 semantics).
 *
 * Rendered in place of the requested section — the user is never bounced to
 * /dashboard — so staff understand exactly why they cannot open a page and
 * what they can do next. Every authenticated role can reach /settings/profile,
 * so it is offered as the always-valid destination.
 */
export function AccessDenied({ section }: { section?: string | null }) {
  const { t } = useLanguage()

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-lg text-center">
        <CardHeader>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-950">
            <ShieldAlert className="h-8 w-8 text-red-600 dark:text-red-400" aria-hidden="true" />
          </div>
          <CardTitle className="text-2xl">{t('accessDenied.title')}</CardTitle>
          <CardDescription className="mt-2">{t('accessDenied.message')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('accessDenied.hint')}</p>
          {section ? (
            <p className="text-xs text-muted-foreground">{t('accessDenied.blocked', { section })}</p>
          ) : null}
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild variant="outline">
              <Link href="/dashboard">
                <Home className="mr-2 h-4 w-4" />
                {t('accessDenied.dashboard')}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/settings/profile">
                <User className="mr-2 h-4 w-4" />
                {t('accessDenied.profile')}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
