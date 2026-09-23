'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight, Home } from 'lucide-react'
import { useLanguage } from '@/components/providers/language-provider'
import { cn } from '@/lib/utils'

const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  patients: 'Patients',
  appointments: 'Appointments',
  treatments: 'Treatments',
  billing: 'Billing',
  inventory: 'Inventory',
  staff: 'Staff',
  settings: 'Settings',
  reports: 'Reports',
  communications: 'Communications',
  lab: 'Lab Orders',
  prescriptions: 'Prescriptions',
  medications: 'Drug Catalog',
  video: 'Video Consults',
  chat: 'AI Chat',
  crm: 'CRM',
  sterilization: 'Sterilization',
  devices: 'Devices',
  onboarding: 'Onboarding',
  // Sub-routes
  new: 'New',
  edit: 'Edit',
  invoices: 'Invoices',
  payments: 'Payments',
  insurance: 'Insurance',
  'payment-plans': 'Payment Plans',
  'pre-auth': 'Pre-Authorizations',
  providers: 'Providers',
  waitlist: 'Waitlist',
  queue: 'Queue',
  plans: 'Treatment Plans',
  memberships: 'Memberships',
  loyalty: 'Loyalty',
  referrals: 'Referrals',
  segments: 'Segments',
  instruments: 'Instruments',
  logs: 'Cycle Logs',
  vendors: 'Vendors',
  transactions: 'Transactions',
  suppliers: 'Suppliers',
  attendance: 'Attendance',
  leaves: 'Leaves',
  invites: 'Invites',
  performance: 'Performance',
  analytics: 'Analytics',
  automations: 'Automations',
  feedback: 'Feedback',
  clinic: 'Clinic',
  ai: 'AI Features',
  forms: 'Forms',
  integrations: 'Integrations',
  pricing: 'Pricing Advisor',
  security: 'Security',
  system: 'System',
  subscription: 'Subscription',
  procedures: 'Procedures',
  // Slug-fallback labels that the dictionaries do not carry verbatim, so they
  // would otherwise render raw English crumbs. Each value below is chosen to be
  // an existing dictionary entry (or an existing English value) so the crumb
  // reuses wording the app already translates:
  //   /settings/setup-guide -> "Setup Guide"
  //   /reports/audit-log    -> "Audit Log"
  //   /lab/orders*          -> "Lab Orders"
  //   /portal/*             -> "Patient Portal"
  //   /settings/access-denied -> "Access denied" (new key, added to both locales)
  'setup-guide': 'Setup Guide',
  'audit-log': 'Audit Log',
  orders: 'Lab Orders',
  portal: 'Patient Portal',
  'access-denied': 'Access denied',
}

function isUUID(segment: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    /^c[a-z0-9]{24,}$/i.test(segment)
  )
}

export function Breadcrumb({ className }: { className?: string }) {
  const pathname = usePathname()
  // `t` resolves both dictionary keys and the English route labels below, so
  // every crumb reuses the exact wording the sidebar already shows.
  const { t } = useLanguage()

  const segments = pathname.split('/').filter(Boolean)

  if (segments.length <= 1) return null

  const crumbs = segments.map((segment, index) => {
    const href = '/' + segments.slice(0, index + 1).join('/')
    const isLast = index === segments.length - 1
    const label = isUUID(segment)
      ? t('breadcrumb.details')
      : t(
          ROUTE_LABELS[segment] ||
            segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ')
        )

    return { label, href, isLast }
  })

  return (
    <nav
      aria-label={t('breadcrumb.aria')}
      className={cn('flex items-center gap-1.5 text-sm text-muted-foreground', className)}
    >
      <Link href="/dashboard" className="hover:text-foreground transition-colors">
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((crumb) => (
        <div key={crumb.href} className="flex items-center gap-1.5">
          <ChevronRight className="h-3.5 w-3.5" />
          {crumb.isLast ? (
            <span className="font-medium text-foreground truncate max-w-[200px]">
              {t(crumb.label)}
            </span>
          ) : (
            <Link
              href={crumb.href}
              className="hover:text-foreground transition-colors truncate max-w-[150px]"
            >
              {t(crumb.label)}
            </Link>
          )}
        </div>
      ))}
    </nav>
  )
}
