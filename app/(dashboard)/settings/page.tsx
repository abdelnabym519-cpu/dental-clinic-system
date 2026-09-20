import { SettingsOverview, type SettingsCategory } from '@/components/settings/settings-overview'
import { auth } from '@/lib/auth'
import { canAccessSettingsSection } from '@/lib/settings-access'

export const metadata = {
  title: 'Settings',
}

/** Every hub card with its destination. Staff management lives outside /settings. */
const ALL_CATEGORIES: SettingsCategory[] = [
  {
    title: 'Setup Guide',
    description: 'Step-by-step instructions to set up everything — start here!',
    icon: 'BookOpen',
    href: '/settings/setup-guide',
    color: 'text-amber-600 bg-amber-50',
  },
  {
    title: 'Clinic Information',
    description: 'Manage clinic details, contact information, and branding',
    icon: 'Building2',
    href: '/settings/clinic',
    color: 'text-blue-600 bg-blue-50',
  },
  {
    title: 'Appointment Settings',
    description: 'Configure time slots, working hours, and holiday calendar',
    icon: 'Calendar',
    href: '/settings/appointments',
    color: 'text-green-600 bg-green-50',
  },
  {
    title: 'Billing Settings',
    description: 'Set up tax rates, invoice format, and payment terms',
    icon: 'Receipt',
    href: '/settings/billing',
    color: 'text-purple-600 bg-purple-50',
  },
  {
    title: 'Communication Settings',
    description: 'Configure SMS gateways, email SMTP, and notifications',
    icon: 'MessageSquare',
    href: '/settings/communications',
    color: 'text-orange-600 bg-orange-50',
  },
  {
    title: 'Procedure Settings',
    description: 'Manage dental procedures and default pricing',
    icon: 'Settings',
    href: '/settings/procedures',
    color: 'text-pink-600 bg-pink-50',
  },
  {
    title: 'User Management',
    description: 'Manage staff accounts, roles, and permissions',
    icon: 'Users',
    href: '/staff',
    color: 'text-indigo-600 bg-indigo-50',
  },
  {
    title: 'System Settings',
    description: 'Backup, export data, and view audit logs',
    icon: 'Database',
    href: '/settings/system',
    color: 'text-red-600 bg-red-50',
  },
  {
    title: 'Security Settings',
    description: 'Password policies, session timeout, and security logs',
    icon: 'Shield',
    href: '/settings/security',
    color: 'text-teal-600 bg-teal-50',
  },
  {
    title: 'Integrations',
    description: 'Connect Google Calendar and other external services',
    icon: 'Link2',
    href: '/settings/integrations',
    color: 'text-cyan-600 bg-cyan-50',
  },
  {
    title: 'Data Import',
    description: 'Import data from CSV, Excel, or PDF files from your previous ERP',
    icon: 'Upload',
    href: '/settings/import',
    color: 'text-emerald-600 bg-emerald-50',
  },
  {
    title: 'My Profile',
    description: 'Your own language and formatting preferences — affects nobody else',
    icon: 'Languages',
    href: '/settings/profile',
    color: 'text-sky-600 bg-sky-50',
  },
]

/**
 * Settings hub — visible to every authenticated role, with cards filtered to
 * the sections the current role may actually open (same rules middleware
 * enforces, from the same source of truth: lib/settings-access.ts).
 */
export default async function SettingsPage() {
  const session = await auth()
  const role = session?.user?.role

  const categories = ALL_CATEGORIES.filter((category) =>
    category.href === '/staff'
      ? role === 'ADMIN' // /staff is outside the settings area — middleware rule: ADMIN only
      : canAccessSettingsSection(category.href, role)
  )

  return <SettingsOverview categories={categories} />
}
