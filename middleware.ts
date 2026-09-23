import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { authConfig } from '@/lib/auth.config'
import { canAccessSettingsSection, settingsSectionFromPath } from '@/lib/settings-access'

// Edge-safe auth: the middleware bundle must not include Prisma. lib/auth.ts
// wires the credentials provider to @prisma/client, which cannot compile in
// the Edge runtime (and breaks the whole middleware bundle when the generated
// client is missing). authConfig carries only pages + jwt/session callbacks —
// identical session decoding (req.auth.user.role), zero Prisma in the bundle.
const { auth } = NextAuth(authConfig)

// Routes that require specific roles.
// NOTE: /settings is intentionally NOT here — the settings area has its own
// fine-grained RBAC in lib/settings-access.ts, enforced below by rewriting
// unauthorized roles to /settings/access-denied (a proper forbidden page)
// instead of redirecting them to /dashboard.
const roleRoutes: Record<string, string[]> = {
  '/staff': ['ADMIN'],
  '/inventory': ['ADMIN'],
  '/billing': ['ADMIN', 'ACCOUNTANT', 'RECEPTIONIST'],
  '/lab': ['ADMIN', 'DOCTOR', 'LAB_TECH'],
  '/treatments': ['ADMIN', 'DOCTOR'],
  '/reports': ['ADMIN', 'ACCOUNTANT', 'DOCTOR'],
  '/communications': ['ADMIN', 'RECEPTIONIST'],
}

// Public routes that don't require authentication.
//
// Everything under /portal and /pay is patient-facing and must not be gated by
// the staff session: patients have their own cookie, issued by the OTP flow and
// checked in app/portal/(secure)/layout.tsx. Gating them here sent patients to
// the staff login page, which made the portal unreachable entirely.
const publicRoutes = [
  '/login',
  '/forgot-password',
  '/signup',
  '/pricing',
  '/verify-email',
  '/invite/accept',
  '/portal',
  '/pay',
  // Phase 9 licensing: an expired, logged-in session must be able to land on
  // this page (the dashboard layout gate redirects here). The page itself
  // still sends SUPER_ADMIN to /super-admin and logged-out visitors to /login.
  '/subscription-expired',
  // Phase 10 — Meta's webhook handshake arrives from Meta's servers with no
  // session. (All /api/* routes already pass through below; listed here so
  // the public intent is explicit if the API pass-through ever gets tightened.)
  '/api/webhooks/whatsapp',
]

export default auth((req) => {
  const { nextUrl, auth: session } = req
  const isLoggedIn = !!session?.user
  const pathname = nextUrl.pathname

  // Public routes - allow access
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route))
  const isLandingPage = pathname === '/'
  const isApiRoute = pathname.startsWith('/api/')
  const isApiAuth = pathname.startsWith('/api/auth')
  const isPublicApi = pathname.startsWith('/api/public')

  // Let all API routes through - they handle their own auth via getAuthenticatedHospital()
  // This is required for mobile app Bearer token auth which bypasses NextAuth cookies
  if (isApiRoute) {
    return NextResponse.next()
  }

  if (isPublicRoute || isLandingPage || isApiAuth || isPublicApi) {
    // If logged in and trying to access login/signup/landing, redirect to dashboard
    if (isLoggedIn && (pathname === '/login' || pathname === '/signup' || pathname === '/')) {
      return NextResponse.redirect(new URL('/dashboard', nextUrl))
    }
    return NextResponse.next()
  }

  // Protected routes - require authentication
  if (!isLoggedIn) {
    const loginUrl = new URL('/login', nextUrl)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Onboarding redirect: if hospital hasn't completed onboarding, force them there
  // (Skip if already on onboarding page or API routes)
  if (pathname.startsWith('/onboarding') || pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Settings-area RBAC (lib/settings-access.ts): unauthorized roles get the
  // Access Denied page in place — same URL, no redirect to /dashboard.
  // The check runs after authentication, so an anonymous visitor still gets
  // the standard redirect to /login with a callbackUrl above.
  const userRole = session.user.role
  if (settingsSectionFromPath(pathname) !== null && !canAccessSettingsSection(pathname, userRole)) {
    return NextResponse.rewrite(new URL('/settings/access-denied', nextUrl))
  }

  // Check role-based access
  for (const [path, roles] of Object.entries(roleRoutes)) {
    if (pathname.startsWith(path)) {
      if (!roles.includes(userRole)) {
        // User doesn't have required role - redirect to dashboard
        return NextResponse.redirect(new URL('/dashboard', nextUrl))
      }
    }
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - api/health and api/ready — the liveness and readiness probes.
     *
     * The probes are excluded here rather than allowed through the handler so
     * that they never invoke auth() at all. An orchestrator polls these every
     * few seconds for the life of the container; making each poll decode a
     * session is wasted work, and it couples the probe to the auth layer, so
     * a fault in auth would take the health check down with it — exactly when
     * an accurate health signal matters most.
     */
    '/((?!_next/static|_next/image|favicon.ico|public|api/health|api/ready).*)',
  ],
}
