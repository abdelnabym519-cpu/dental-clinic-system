import 'next-auth'

declare module 'next-auth' {
  interface User {
    id: string
    email: string
    name: string
    role: string
    staffId?: string
    // Nullable: the platform-level SUPER_ADMIN (Phase 9) belongs to no hospital.
    hospitalId: string | null
    isHospitalAdmin: boolean
    // Derived convenience flag: role === 'SUPER_ADMIN'.
    isSuperAdmin: boolean
  }

  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: string
      staffId?: string
      hospitalId: string | null
      isHospitalAdmin: boolean
      isSuperAdmin: boolean
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role: string
    staffId?: string
    hospitalId: string | null
    isHospitalAdmin: boolean
    isSuperAdmin: boolean
  }
}
