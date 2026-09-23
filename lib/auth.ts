import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { authConfig } from './auth.config'
import { prisma, isPrismaFallback } from './prisma'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

/**
 * Credentials authorize — exported for testing the full login flow against
 * seed-produced data (tests/unit/seed-auth-flow.test.ts).
 */
export async function authorize(credentials: unknown) {
  const validated = loginSchema.safeParse(credentials)

  if (!validated.success) return null

  const { email, password } = validated.data

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      staff: true,
      hospital: true,
    },
  })

  if (!user) {
    // Never say "invalid credentials" silently when the real problem is a
    // missing/unusable Prisma client (e.g. right after a migrate reset that
    // regenerated the client while this server was running).
    if (isPrismaFallback()) {
      console.error(
        `[dentora] Login for ${email} failed because the Prisma client is in ` +
          `fallback mode (every lookup returns null). Run "npx prisma generate" ` +
          `and RESTART the dev server — the credentials themselves may be fine.`
      )
    }
    return null
  }

  if (!user.isActive) return null

  // Phase 9 licensing: SUPER_ADMIN is a platform-level account (hospitalId is
  // null) — it never logs into a hospital's workspace, so the hospital-active
  // gate does not apply to it. Every other role still requires an active hospital.
  if (user.role !== 'SUPER_ADMIN') {
    // Check if the user's hospital is active
    if (!user.hospital || !user.hospital.isActive) return null
  }

  const passwordMatch = await bcrypt.compare(password, user.password)
  if (!passwordMatch) return null

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    staffId: user.staff?.id,
    hospitalId: user.hospitalId,
    isHospitalAdmin: user.isHospitalAdmin,
    // Phase 9: part of the next-auth User contract (types/next-auth.d.ts).
    isSuperAdmin: user.role === 'SUPER_ADMIN',
  }
}

export const { auth, signIn, signOut, handlers } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      authorize,
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
  },
})

// Helper function to get current user
export async function getCurrentUser() {
  const session = await auth()
  return session?.user
}

// Helper function to check if user has required role
export function hasRole(userRole: string, allowedRoles: string[]): boolean {
  return allowedRoles.includes(userRole)
}

// Role hierarchy for permission checking
export const roleHierarchy: Record<string, number> = {
  SUPER_ADMIN: 6, // Phase 9: platform-level, above every hospital role
  ADMIN: 5,
  DOCTOR: 4,
  ACCOUNTANT: 3,
  RECEPTIONIST: 2,
  LAB_TECH: 1,
}

export function hasMinimumRole(userRole: string, minimumRole: string): boolean {
  return (roleHierarchy[userRole] || 0) >= (roleHierarchy[minimumRole] || 0)
}
