// @ts-nocheck
import { describe, it, expect, vi, beforeAll } from 'vitest'
import bcrypt from 'bcryptjs'

/**
 * Full auth flow after `migrate reset` + seed — no database required.
 *
 * Part A runs the REAL prisma/seed.ts against a capturing mock client and
 * asserts what it writes: hospital + users active on BOTH upsert legs, the
 * documented credentials ('Admin@123') verified against the REAL bcrypt hash
 * the seed just computed, and the final updateMany enforcement as the last
 * writes of the seed.
 *
 * Part B feeds Part A's captured row through the REAL exported authorize()
 * from lib/auth.ts (the exact function the credentials provider calls) and
 * asserts it accepts the seeded admin and rejects everything it must.
 *
 * Regression context: after a `migrate reset`, a stale/missing generated
 * Prisma client used to surface as "Invalid email or password" (the silent
 * null-fallback in lib/prisma.ts). authorize() now distinguishes that case,
 * and these tests pin the seed→login contract itself.
 */

// ---------------------------------------------------------------------------
// Capturing mock Prisma client (what the seed's `new PrismaClient()` returns)
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  opLog: [], // ordered [{ kind: 'upsert'|'updateMany', model, args }]
  hospitalUpsert: null,
  userUpserts: [],
  updateManys: [],
  // Part B: rows served by the mocked lib/prisma used by authorize()
  currentUserRow: null,
  fallback: false,
}))

vi.mock('@prisma/client', () => {
  // Enums: seed uses e.g. Role.ADMIN, Plan.PROFESSIONAL — member access
  // resolves to the member name, exactly how Prisma enums behave.
  const makeEnum = () => new Proxy({}, { get: (_t, member) => String(member) })
  class PrismaClient {
    constructor() {
      return captureClient
    }
  }
  return {
    PrismaClient,
    Role: makeEnum(),
    Gender: makeEnum(),
    BloodGroup: makeEnum(),
    ProcedureCategory: makeEnum(),
    Plan: makeEnum(),
    InvoiceStatus: makeEnum(),
    SupplierStatus: makeEnum(),
    InventoryItemType: makeEnum(),
    StockTransactionType: makeEnum(),
    StockAlertType: makeEnum(),
    LabVendorStatus: makeEnum(),
    LabOrderStatus: makeEnum(),
    LabOrderPriority: makeEnum(),
    LabWorkType: makeEnum(),
    AppointmentStatus: makeEnum(),
    AppointmentType: makeEnum(),
    LeaveType: makeEnum(),
    LeaveStatus: makeEnum(),
  }
})

const captureClient = new Proxy(
  {},
  {
    get(_t, model) {
      if (model === '$disconnect') return async () => {}
      return new Proxy(
        {},
        {
          get(_t2, method) {
            return async (args) => {
              if (method === 'count') return 1 // keeps conditional demo-data blocks off
              if (method === 'upsert') {
                state.opLog.push({ kind: 'upsert', model, args })
                if (model === 'hospital') state.hospitalUpsert = args
                if (model === 'user') state.userUpserts.push(args)
                return { id: `mock-${model}-1`, ...args.create }
              }
              if (method === 'updateMany') {
                state.opLog.push({ kind: 'updateMany', model, args })
                state.updateManys.push({ model, args })
                return { count: 1 }
              }
              if (method === 'create') return { id: `mock-${model}-1`, ...args.create }
              if (method === 'createMany' || method === 'update' || method === 'deleteMany')
                return { count: 1 }
              if (method === 'findMany' || method === 'groupBy') return []
              if (method === 'aggregate') return {}
              return null // findUnique, findFirst, …
            }
          },
        }
      )
    },
  }
)

// ---------------------------------------------------------------------------
// Mocks for the auth module (Part B)
// ---------------------------------------------------------------------------

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: async ({ where }) => state.currentUserRow,
    },
  },
  isPrismaFallback: () => state.fallback,
  default: {
    user: { findUnique: async () => state.currentUserRow },
  },
}))

vi.mock('next-auth', () => ({
  default: () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }),
}))

// ---------------------------------------------------------------------------
// Part A — run the REAL seed
// ---------------------------------------------------------------------------

let seedModule

beforeAll(async () => {
  seedModule = await import('../../prisma/seed')
  // main() is fired (not awaited) by the seed module itself — wait until its
  // LAST writes (the isActive enforcement updateManys) have landed.
  await vi.waitFor(
    () => {
      expect(state.updateManys.length).toBeGreaterThanOrEqual(2)
    },
    { timeout: 15000, interval: 50 }
  )
})

describe('Part A — the seed writes a loginable hospital + admin', () => {
  it('seed ran to completion through the mock client', () => {
    expect(seedModule).toBeTruthy()
    expect(state.hospitalUpsert).toBeTruthy()
    // The three core accounts upsert unconditionally. (doctor2 seeds only
    // alongside the demo-appointment block — count-mock skips it.)
    expect(state.userUpserts.length).toBeGreaterThanOrEqual(3)
  })

  it('hospital upsert is active on BOTH legs (create + update)', () => {
    const { args } = { args: state.hospitalUpsert }
    expect(args.create.isActive).toBe(true)
    expect(args.update.isActive).toBe(true)
  })

  it('admin user: create-leg password REALLY verifies against Admin@123', async () => {
    const admin = state.userUpserts.find((u) => u.where.email === 'admin@dentora-dental.com')
    expect(admin).toBeTruthy()
    expect(admin.create.isActive).toBe(true)
    expect(typeof admin.create.password).toBe('string')
    // The decisive check: the hash the seed just computed must match the
    // documented credential — this is exactly what bcrypt.compare does in
    // authorize().
    const ok = await bcrypt.compare('Admin@123', admin.create.password)
    expect(ok).toBe(true)
    // Wrong password must NOT verify against the same hash.
    const bad = await bcrypt.compare('wrong-password', admin.create.password)
    expect(bad).toBe(false)
  })

  it('admin user: update leg re-activates AND re-stamps the documented password', async () => {
    const admin = state.userUpserts.find((u) => u.where.email === 'admin@dentora-dental.com')
    expect(admin.update.isActive).toBe(true)
    expect(admin.update.password).toBeTruthy()
    const ok = await bcrypt.compare('Admin@123', admin.update.password)
    expect(ok).toBe(true)
  })

  it('all documented staff accounts are seeded with matching roles', async () => {
    const expected = [
      ['admin@dentora-dental.com', 'ADMIN', 'Admin@123'],
      ['doctor@dentora-dental.com', 'DOCTOR', 'Doctor@123'],
      ['reception@dentora-dental.com', 'RECEPTIONIST', 'Reception@123'],
      // doctor2@dentora-dental.com is optional here: it seeds only together
      // with demo appointments (appointmentCount === 0 guard). Verified when present.
      ['doctor2@dentora-dental.com', 'DOCTOR', 'Admin@123'],
    ]
    for (const [email, role, password] of expected) {
      const upsert = state.userUpserts.find((u) => u.where.email === email)
      if (email === 'doctor2@dentora-dental.com' && !upsert) continue
      expect(upsert, email).toBeTruthy()
      expect(upsert.create.role).toBe(role)
      expect(upsert.update.isActive).toBe(true)
      const ok = await bcrypt.compare(password, upsert.create.password)
      expect(ok, `${email} create-leg hash must verify`).toBe(true)
    }
  })

  it('the LAST writes of the seed force every hospital and user active', () => {
    const models = state.updateManys.map((u) => u.model)
    expect(models).toEqual(expect.arrayContaining(['hospital', 'user']))
    for (const u of state.updateManys) {
      expect(u.args.data).toEqual({ isActive: true })
    }
    // Guarantee ordering: the updateMany enforcement comes after all upserts.
    const lastUpsertIdx = state.opLog.map((o) => o.kind).lastIndexOf('upsert')
    const firstEnforceIdx = state.opLog.findIndex((o) => o.kind === 'updateMany')
    expect(firstEnforceIdx).toBeGreaterThan(lastUpsertIdx)
  })
})

// ---------------------------------------------------------------------------
// Part B — the REAL authorize() accepts exactly what the seed created
// ---------------------------------------------------------------------------

function seededAdminRow(overrides = {}) {
  const admin = state.userUpserts.find((u) => u.where.email === 'admin@dentora-dental.com')
  return {
    id: 'user-admin-1',
    email: 'admin@dentora-dental.com',
    name: admin.create.name,
    password: admin.create.password, // REAL hash captured from the seed run
    role: 'ADMIN',
    isActive: true,
    hospitalId: 'hospital-1',
    isHospitalAdmin: true,
    staff: { id: 'staff-1' },
    hospital: { id: 'hospital-1', isActive: true },
    ...overrides,
  }
}

describe('Part B — authorize() (the credentials provider function)', () => {
  it('accepts the seeded admin with the documented credential', async () => {
    const { authorize } = await import('@/lib/auth')
    state.currentUserRow = seededAdminRow()
    const user = await authorize({ email: 'admin@dentora-dental.com', password: 'Admin@123' })
    expect(user).toBeTruthy()
    expect(user.role).toBe('ADMIN')
    expect(user.email).toBe('admin@dentora-dental.com')
    expect(user.hospitalId).toBe('hospital-1')
  })

  it('rejects a wrong password with the correct hash present', async () => {
    const { authorize } = await import('@/lib/auth')
    state.currentUserRow = seededAdminRow()
    const user = await authorize({ email: 'admin@dentora-dental.com', password: 'WrongPass1' })
    expect(user).toBeNull()
  })

  it('rejects an inactive user even with the correct credential', async () => {
    const { authorize } = await import('@/lib/auth')
    state.currentUserRow = seededAdminRow({ isActive: false })
    const user = await authorize({ email: 'admin@dentora-dental.com', password: 'Admin@123' })
    expect(user).toBeNull()
  })

  it('rejects a user whose hospital is inactive', async () => {
    const { authorize } = await import('@/lib/auth')
    state.currentUserRow = seededAdminRow({ hospital: { id: 'hospital-1', isActive: false } })
    const user = await authorize({ email: 'admin@dentora-dental.com', password: 'Admin@123' })
    expect(user).toBeNull()
  })

  it('rejects an unknown email (no row)', async () => {
    const { authorize } = await import('@/lib/auth')
    state.currentUserRow = null
    const user = await authorize({ email: 'nobody@dentora-dental.com', password: 'Admin@123' })
    expect(user).toBeNull()
  })

  it('rejects malformed credentials without touching the database', async () => {
    const { authorize } = await import('@/lib/auth')
    state.currentUserRow = seededAdminRow()
    expect(await authorize({ email: 'not-an-email', password: 'Admin@123' })).toBeNull()
    expect(await authorize({ email: 'admin@dentora-dental.com', password: '12345' })).toBeNull()
  })
})
