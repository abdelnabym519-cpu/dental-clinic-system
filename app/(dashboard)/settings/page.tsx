import { SettingsOverview, type SettingsCategory } from '@/components/settings/settings-overview'
import { auth } from '@/lib/auth'
import { canAccessSettingsSection } from '@/lib/settings-access'
import { getServerTranslator } from '@/lib/i18n/server'

export async function generateMetadata() {
  // Browser-tab title follows the selected locale, like the rendered UI.
  const { t } = await getServerTranslator()
  return { title: t('Settings') }
}

/** Every hub card with its destination. Staff management lives outside /settings. */
const ALL_CATEGORIES: SettingsCategory[] = [
  {
    title: 'settings.cards.setupGuide.title',
    description: 'settings.cards.setupGuide.desc',
    icon: 'BookOpen',
    href: '/settings/setup-guide',
    color: 'text-amber-600 bg-amber-50',
  },
  {
    title: 'settings.cards.clinic.title',
    description: 'settings.cards.clinic.desc',
    icon: 'Building2',
    href: '/settings/clinic',
    color: 'text-blue-600 bg-blue-50',
  },
  {
    title: 'settings.cards.appointments.title',
    description: 'settings.cards.appointments.desc',
    icon: 'Calendar',
    href: '/settings/appointments',
    color: 'text-green-600 bg-green-50',
  },
  {
    title: 'settings.cards.billing.title',
    description: 'settings.cards.billing.desc',
    icon: 'Receipt',
    href: '/settings/billing',
    color: 'text-purple-600 bg-purple-50',
  },
  {
    title: 'settings.cards.communications.title',
    description: 'settings.cards.communications.desc',
    icon: 'MessageSquare',
    href: '/settings/communications',
    color: 'text-orange-600 bg-orange-50',
  },
  {
    title: 'settings.cards.procedures.title',
    description: 'settings.cards.procedures.desc',
    icon: 'Settings',
    href: '/settings/procedures',
    color: 'text-pink-600 bg-pink-50',
  },
  {
    title: 'settings.cards.staff.title',
    description: 'settings.cards.staff.desc',
    icon: 'Users',
    href: '/staff',
    color: 'text-indigo-600 bg-indigo-50',
  },
  {
    title: 'settings.cards.system.title',
    description: 'settings.cards.system.desc',
    icon: 'Database',
    href: '/settings/system',
    color: 'text-red-600 bg-red-50',
  },
  {
    title: 'settings.cards.security.title',
    description: 'settings.cards.security.desc',
    icon: 'Shield',
    href: '/settings/security',
    color: 'text-teal-600 bg-teal-50',
  },
  {
    title: 'settings.cards.integrations.title',
    description: 'settings.cards.integrations.desc',
    icon: 'Link2',
    href: '/settings/integrations',
    color: 'text-cyan-600 bg-cyan-50',
  },
  {
    title: 'settings.cards.import.title',
    description: 'settings.cards.import.desc',
    icon: 'Upload',
    href: '/settings/import',
    color: 'text-emerald-600 bg-emerald-50',
  },
  {
    title: 'settings.cards.profile.title',
    description: 'settings.cards.profile.desc',
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
