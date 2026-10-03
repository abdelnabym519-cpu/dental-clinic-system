import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { cookies } from 'next/headers'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { Providers } from '@/components/providers'
import { LanguageProvider } from '@/components/providers/language-provider'
import { directionFor, translateText } from '@/lib/i18n/dictionary'
import { defaultLocale } from '@/lib/i18n/config'

// Phase 11 (§52/§69): Inter is SELF-HOSTED (next/font/local, OFL-licensed
// files vendored from @fontsource/inter 5.3.0). The previous next/font/google
// binding made every production build require fonts.googleapis.com — an
// external fetch at build time that broke reproducibility and failed entirely
// in offline/proxied environments. Same family, same subsets behavior, same
// CSS variable wiring — no visual change intended.
const inter = localFont({
  src: [
    { path: './fonts/inter-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/inter-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/inter-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/inter-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-inter',
})

export async function generateMetadata(): Promise<Metadata> {
  // Browser-tab title and social previews follow the selected locale exactly
  // like the rendered UI does: the language is a user/clinic preference, so it
  // cannot live in a static object evaluated once at build time.
  // ISSUE 6 — Arabic-only: metadata locale is the Arabic default.
  const locale = defaultLocale
  const t = (text: string) => translateText(locale, text)

  const title = t('Dentora — Egyptian Dental Clinic Management')

  return {
    title: {
      default: title,
      template: '%s | Dentora',
    },
    description: t(
      'Dental clinic management for Egypt. Patient records, appointment scheduling, VAT billing, inventory, AI-powered treatment planning, insurance claims, tele-dentistry. Built for Egyptian dental hospitals and clinics.'
    ),
    keywords: [
      'dental software Egypt',
      'dental clinic management software',
      'dental hospital management system',
      'dental ERP',
      'dental practice management',
      'open source dental software',
      'برنامج عيادات أسنان',
      'نظام إدارة عيادات',
      'patient management system dental',
      'appointment scheduling dental',
      'dental clinic software',
      'hospital management system Egypt',
      'dental records software',
      'AI dental software',
      'tele-dentistry Egypt',
      'dental inventory management',
      'dental insurance claims',
      'dental lab management',
      'multi-branch dental software',
    ],
    authors: [{ name: 'Dentora' }],
    creator: 'Dentora',
    manifest: '/manifest.json',
    openGraph: {
      type: 'website',
      locale: locale === 'ar-EG' ? 'ar_EG' : 'en_US',
      title,
      description: t(
        'AI-powered dental clinic management system built for Egyptian dental clinics. Patient records, VAT billing, appointments, inventory, insurance, tele-dentistry and more.'
      ),
      siteName: 'Dentora',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: t(
        'AI-powered dental clinic management system for Egypt. 16 AI skills, VAT billing, patient portal, tele-dentistry.'
      ),
    },
    robots: {
      index: true,
      follow: true,
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: 'Dentora',
    },
  }
}

export const viewport: Viewport = {
  themeColor: '#0891B2',
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // ISSUE 6 — the system is ARABIC-ONLY: <html lang dir> is always the
  // Arabic default (RTL). The cookie is read for compatibility but can no
  // longer select a locale (the selector UI was removed); stored User.locale
  // preferences cannot render the product in anything but Arabic.
  const locale = defaultLocale
  const dir = directionFor(locale)

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          {/* Toaster lives inside the provider so toast copy is translated
              with the visitor's locale, not the default one. */}
          <LanguageProvider initialLocale={locale}>
            {children}
            <Toaster />
          </LanguageProvider>
        </Providers>
      </body>
    </html>
  )
}
