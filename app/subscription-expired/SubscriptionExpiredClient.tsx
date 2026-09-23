'use client'

import { signOut } from 'next-auth/react'
import { useLanguage } from '@/components/providers/language-provider'

export function SubscriptionExpiredClient({ userEmail }: { userEmail: string }) {
  const { t } = useLanguage()

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="max-w-md w-full rounded-2xl border bg-background p-8 text-center shadow-lg">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <svg
            className="h-8 w-8 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.962-.833-2.732 0L3.268 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        </div>

        <h1 className="mb-3 text-2xl font-bold">{t('subscription.expired_title')}</h1>
        <p className="mb-2 text-muted-foreground">{t('subscription.expired_body')}</p>
        {userEmail && (
          <p className="mb-8 text-sm text-muted-foreground/70">
            {t('subscription.logged_in_as', { email: userEmail })}
          </p>
        )}

        <a
          href="mailto:support@dentora.com?subject=DenToRa%20%E2%80%94%20subscription%20renewal"
          className="mb-3 block w-full rounded-xl bg-primary py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t('subscription.contact_to_renew')}
        </a>

        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="block w-full rounded-xl bg-muted py-3 font-medium transition-colors hover:bg-muted/70"
        >
          {t('common.signOut')}
        </button>
      </div>
    </div>
  )
}
