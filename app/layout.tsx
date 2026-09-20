import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { cookies } from 'next/headers'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { Providers } from '@/components/providers'
import { LanguageProvider, LOCALE_COOKIE } from '@/components/providers/language-provider'
import { directionFor, translate } from '@/lib/i18n/dictionary'
import { resolveLocale } from '@/lib/i18n/config'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: {
    default: 'DentalERP - Open Source Dental Hospital Management Software India',
    template: '%s | DentalERP',
  },
  description:
    'Free open-source dental clinic management software for India. Patient records, appointment scheduling, GST billing, inventory, AI-powered treatment planning, insurance claims, tele-dentistry. Built for Indian dental hospitals and clinics.',
  keywords: [
    'dental software India',
    'dental clinic management software',
    'dental hospital management system',
    'dental ERP',
    'dental practice management',
    'open source dental software',
    'free dental software India',
    'dental billing software GST',
    'patient management system dental',
    'appointment scheduling dental',
    'dental clinic software free',
    'hospital management system India',
    'HMS India',
    'dental records software',
    'AI dental software',
    'tele-dentistry India',
    'dental inventory management',
    'dental insurance claims India',
    'dental lab management',
    'multi-branch dental software',
  ],
  authors: [{ name: 'Abinauv Selvaraj' }],
  creator: 'Abinauv Selvaraj',
  manifest: '/manifest.json',
  openGraph: {
    type: 'website',
    locale: 'en_IN',
    title: 'DentalERP - Open Source Dental Hospital Management Software',
    description:
      'Free, AI-powered dental clinic management system built for Indian dental hospitals. Patient records, GST billing, appointments, inventory, insurance, tele-dentistry and more.',
    siteName: 'DentalERP',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DentalERP - Open Source Dental Hospital Management Software',
    description:
      'Free, AI-powered dental clinic management system for India. 16 AI skills, GST billing, patient portal, tele-dentistry.',
  },
  robots: {
    index: true,
    follow: true,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'DentalERP',
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
          <LanguageProvider initialLocale={locale}>{children}</LanguageProvider>
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
