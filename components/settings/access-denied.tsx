import Link from 'next/link'
import { Home, ShieldAlert, User } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Forbidden screen for the settings area (HTTP 403 semantics).
 *
 * Rendered in place of the requested section — the user is never bounced to
 * /dashboard — so staff understand exactly why they cannot open a page and
 * what they can do next. Every authenticated role can reach /settings/profile,
 * so it is offered as the always-valid destination.
 */
export function AccessDenied({ section }: { section?: string | null }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-lg text-center">
        <CardHeader>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-950">
            <ShieldAlert className="h-8 w-8 text-red-600 dark:text-red-400" aria-hidden="true" />
          </div>
          <CardTitle className="text-2xl">Access Denied — 403</CardTitle>
          <CardDescription className="mt-2">
            Your role does not have permission to view this settings section.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground" dir="rtl" lang="ar-EG">
            ليس لديك صلاحية الوصول إلى هذا القسم من الإعدادات. تواصل مع مدير العيادة إذا كنت
            بحاجة إلى صلاحية.
          </p>
          {section ? (
            <p className="text-xs text-muted-foreground">Blocked section: {section}</p>
          ) : null}
          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild variant="outline">
              <Link href="/dashboard">
                <Home className="mr-2 h-4 w-4" />
                Go to Dashboard
              </Link>
            </Button>
            <Button asChild>
              <Link href="/settings/profile">
                <User className="mr-2 h-4 w-4" />
                My Profile
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
