/**
 * Explicit dev-admin password restore (scripts/restore-dev-admin.ts) — no database.
 *
 * Pins the exact boundaries of the one write this command is allowed to make:
 * one row (the canonical seeded admin), one column (password), a real bcrypt
 * hash of the documented credential, and fail-closed behavior on database
 * errors. It must never re-activate the account, touch other users, or
 * silently guess when the database cannot be reached.
 */
import { describe, expect, it, vi } from 'vitest'
import bcrypt from 'bcryptjs'

import {
  DEV_ADMIN_PASSWORD,
  restoreDevAdminPassword,
  type RestoreTarget,
} from '../../scripts/restore-dev-admin'
import { SEEDED_ADMIN_EMAIL } from '../../scripts/seed-check'

interface Harness {
  client: RestoreTarget
  findUnique: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

function makeHarness(
  admin: { id: string; isActive: boolean } | null,
  overrides: { findUniqueError?: Error; updateError?: Error } = {}
): Harness {
  const findUnique = vi.fn(async () => {
    if (overrides.findUniqueError) throw overrides.findUniqueError
    return admin
  })
  const update = vi.fn(async () => {
    if (overrides.updateError) throw overrides.updateError
    return undefined
  })
  const client: RestoreTarget = { user: { findUnique, update } }
  return { client, findUnique, update }
}

describe('restoreDevAdminPassword', () => {
  it('restores the documented credential on the canonical admin — one row, one column', async () => {
    const written: Array<{ where: { id: string }; data: Record<string, string> }> = []
    const client: RestoreTarget = {
      user: {
        findUnique: async (args) => {
          expect(args).toEqual({
            where: { email: SEEDED_ADMIN_EMAIL },
            select: { id: true, isActive: true },
          })
          return { id: 'u-admin', isActive: true }
        },
        update: async (args) => {
          written.push(args)
          return undefined
        },
      },
    }

    const result = await restoreDevAdminPassword(client)

    expect(result).toEqual({ status: 'restored', email: SEEDED_ADMIN_EMAIL, accountActive: true })
    expect(written).toHaveLength(1)
    // Exactly one row, addressed by id, with exactly one changed column.
    expect(written[0].where).toEqual({ id: 'u-admin' })
    expect(Object.keys(written[0].data)).toEqual(['password'])
    // The stored value must be a real bcrypt hash of the documented password.
    await expect(bcrypt.compare(DEV_ADMIN_PASSWORD, written[0].data.password)).resolves.toBe(true)
  })

  it('does not store a wrong password', async () => {
    const written: string[] = []
    const client: RestoreTarget = {
      user: {
        findUnique: async () => ({ id: 'u-admin', isActive: true }),
        update: async (args) => {
          written.push(args.data.password)
          return undefined
        },
      },
    }
    await restoreDevAdminPassword(client)
    await expect(bcrypt.compare('WrongPassword', written[0])).resolves.toBe(false)
  })

  it('surfaces the inactive state instead of force-activating the account', async () => {
    const { client, update } = makeHarness({ id: 'u-admin', isActive: false })
    const result = await restoreDevAdminPassword(client)
    expect(result).toEqual({ status: 'restored', email: SEEDED_ADMIN_EMAIL, accountActive: false })
    // The only write is the password; isActive is never touched.
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u-admin' },
      data: expect.objectContaining({ password: expect.any(String) }),
    })
  })

  it('missing admin: returns missing and writes nothing', async () => {
    const { client, update } = makeHarness(null)
    const result = await restoreDevAdminPassword(client)
    expect(result).toEqual({ status: 'missing', email: SEEDED_ADMIN_EMAIL })
    expect(update).not.toHaveBeenCalled()
  })

  it('database error on lookup: fails closed, never assumes "uninitialized"', async () => {
    const { client, update } = makeHarness(null, {
      findUniqueError: new Error('P1001: Can not reach database'),
    })
    await expect(restoreDevAdminPassword(client)).rejects.toThrow(/P1001/)
    expect(update).not.toHaveBeenCalled()
  })

  it('database error on the write: propagates; caller must treat the state as unknown', async () => {
    const { client } = makeHarness(
      { id: 'u-admin', isActive: true },
      {
        updateError: new Error('P2024: record not found'),
      }
    )
    await expect(restoreDevAdminPassword(client)).rejects.toThrow(/P2024/)
  })
})
