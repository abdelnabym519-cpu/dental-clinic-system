import type { NextAuthConfig } from 'next-auth'

export const authConfig: NextAuthConfig = {
  trustHost: true,
  // next-auth v5 reads ONLY `AUTH_SECRET`; this repository's documented
  // environment contract (`.env.example`, `npm run setup:dev`) provisions
  // `NEXTAUTH_SECRET` — which other modules also read directly (mobile JWT
  // helpers). Without this mapping every signIn/session/proxy-auth call fails
  // with MissingSecret on a machine that followed the documented setup.
  // Defined HERE (the shared config) so both NextAuth instances inherit it:
  // lib/auth.ts (credentials provider, Node runtime) and proxy.ts/middleware.ts
  // (edge-safe instance constructed from the bare authConfig).
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const pathname = nextUrl.pathname

      // Public routes that don't require auth
      const publicRoutes = [
        '/login',
        '/forgot-password',
        '/signup',
        '/pricing',
        '/verify-email',
        '/invite/accept',
      ]

      const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route))
      const isLandingPage = pathname === '/'

      if (isPublicRoute || isLandingPage) {
        // If logged in and trying to access login/signup, redirect to dashboard
        if (isLoggedIn && (pathname === '/login' || pathname === '/signup' || pathname === '/')) {
          return Response.redirect(new URL('/dashboard', nextUrl))
        }
        return true
      }

      // All other routes require authentication
      if (!isLoggedIn) return false

      return true
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
        token.staffId = user.staffId
        token.hospitalId = user.hospitalId
        token.isHospitalAdmin = user.isHospitalAdmin
        // Phase 9 licensing: platform-level admin, derived from the role so
        // the flag can never drift from the role itself.
        token.isSuperAdmin = user.role === 'SUPER_ADMIN'
      }
      return token
    },
    session({ session, token }) {
      if (token) {
        session.user.id = token.id as string
        session.user.role = token.role as string
        session.user.staffId = token.staffId as string | undefined
        session.user.hospitalId = (token.hospitalId as string | null) ?? null
        session.user.isHospitalAdmin = token.isHospitalAdmin as boolean
        session.user.isSuperAdmin = token.isSuperAdmin === true || token.role === 'SUPER_ADMIN'
      }
      return session
    },
  },
  providers: [],
}
