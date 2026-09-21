import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { cookies } from 'next/headers'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { Providers } from '@/components/providers'
import { LanguageProvider } from '@/components/providers/language-provider'
import { directionFor } from '@/lib/i18n/dictionary'
import { LOCALE_COOKIE, resolveLocale } from '@/lib/i18n/config'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: {
    default: 'Dentora — Egyptian Dental Clinic Management',
    template: '%s | Dentora',
  },
  description:
    'Dental clinic management for Egypt. Patient records, appointment scheduling, VAT billing, inventory, AI-powered treatment planning, insurance claims, tele-dentistry. Built for Egyptian dental hospitals and clinics.',
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
    locale: 'ar_EG',
    title: 'Dentora — Egyptian Dental Clinic Management',
    description:
      'AI-powered dental clinic management system built for Egyptian dental clinics. Patient records, VAT billing, appointments, inventory, insurance, tele-dentistry and more.',
    siteName: 'Dentora',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Dentora — Egyptian Dental Clinic Management',
    description:
      'AI-powered dental clinic management system for Egypt. 16 AI skills, VAT billing, patient portal, tele-dentistry.'
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

export const viewport: Viewport = {
  themeColor: '#0891B2',
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Locale precedence for <html lang/dir>: explicit cookie choice (login /
  // profile selector) → default. Authenticated users' stored User.locale is
  // mirrored into the cookie by the profile selector.
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value
  const locale = resolveLocale(cookieLocale)
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
