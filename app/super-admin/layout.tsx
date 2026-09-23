import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'

/**
 * Phase 9 licensing — SUPER_ADMIN control panel.
 *
 * Hard guard: only the platform-level SUPER_ADMIN role may render anything
 * under /super-admin. Everyone else is sent to /login (the session itself
 * may be valid — this page is simply not for them; there is no hospital
 * workspace for a non-super admin to fall back to here).
 */
export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()

  if (
    !session?.user ||
    (session.user.isSuperAdmin !== true && session.user.role !== 'SUPER_ADMIN')
  ) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="border-b border-gray-800 bg-gray-900 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold uppercase tracking-wider text-red-500">
            Super Admin
          </span>
          <span className="text-gray-600">|</span>
          <span className="text-sm text-gray-300">DenToRa Control Panel</span>
        </div>
      </nav>
      <main className="p-6">{children}</main>
    </div>
  )
}
