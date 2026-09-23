import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Phase 9 licensing — SUPER_ADMIN only: manage a hospital's subscription.
 *
 * POST  -> create the subscription (with a CREATED audit entry)
 * PATCH -> update plan/status/period/grace/notes (with an audit entry)
 *
 * Every mutation is recorded in LicenseAuditLog with the acting SUPER_ADMIN
 * user id — the audit trail is append-only and cascades with the row.
 */

const PLAN_VALUES = ['FREE', 'PROFESSIONAL', 'ENTERPRISE', 'SELF_HOSTED'] as const

const STATUS_VALUES = [
  'TRIAL',
  'ACTIVE',
  'GRACE_PERIOD',
  'EXPIRED',
  'SUSPENDED',
  'CANCELLED',
] as const

const CreateSubscriptionSchema = z.object({
  plan: z.enum(PLAN_VALUES).default('PROFESSIONAL'),
  status: z.enum(STATUS_VALUES).default('ACTIVE'),
  currentPeriodStart: z.string().datetime(),
  currentPeriodEnd: z.string().datetime(),
  gracePeriodDays: z.number().int().min(0).max(30).default(3),
  autoRenew: z.boolean().default(false),
  notes: z.string().optional(),
})

const UpdateSubscriptionSchema = z.object({
  plan: z.enum(PLAN_VALUES).optional(),
  status: z.enum(STATUS_VALUES).optional(),
  currentPeriodStart: z.string().datetime().optional(),
  currentPeriodEnd: z.string().datetime().optional(),
  gracePeriodDays: z.number().int().min(0).max(30).optional(),
  autoRenew: z.boolean().optional(),
  notes: z.string().optional(),
})

async function requireSuperAdmin() {
  const session = await auth()
  const isSuperAdmin = session?.user?.isSuperAdmin === true || session?.user?.role === 'SUPER_ADMIN'
  if (!isSuperAdmin) {
    return {
      session: null,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    }
  }
  return { session, response: null }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { session, response } = await requireSuperAdmin()
  if (response) return response

  const body = await req.json().catch(() => null)
  const parsed = CreateSubscriptionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const hospital = await prisma.hospital.findUnique({ where: { id: id } })
  if (!hospital) {
    return NextResponse.json({ error: 'Hospital not found' }, { status: 404 })
  }

  const existing = await prisma.subscription.findUnique({ where: { hospitalId: id } })
  if (existing) {
    return NextResponse.json({ error: 'Subscription already exists — use PATCH' }, { status: 409 })
  }

  const data = parsed.data
  // Interactive transaction: the audit entry needs the id of the row it
  // describes, which only exists after the create runs.
  const created = await prisma.$transaction(async (tx: any) => {
    const subscription = await tx.subscription.create({
      data: {
        hospitalId: id,
        plan: data.plan,
        status: data.status,
        currentPeriodStart: new Date(data.currentPeriodStart),
        currentPeriodEnd: new Date(data.currentPeriodEnd),
        gracePeriodDays: data.gracePeriodDays,
        autoRenew: data.autoRenew,
        notes: data.notes,
        managedBy: session!.user.id,
      },
    })
    await tx.licenseAuditLog.create({
      data: {
        subscriptionId: subscription.id,
        action: 'CREATED',
        previousStatus: null,
        newStatus: data.status,
        performedBy: session!.user.id,
        notes: data.notes ?? `Created by SUPER_ADMIN: ${session!.user.email}`,
        metadata: { changes: data },
      },
    })
    return subscription
  })

  return NextResponse.json(created, { status: 201 })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { session, response } = await requireSuperAdmin()
  if (response) return response

  const body = await req.json().catch(() => null)
  const parsed = UpdateSubscriptionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 })
  }

  const existing = await prisma.subscription.findUnique({ where: { hospitalId: id } })
  if (!existing) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
  }

  const changes = parsed.data
  const result = await prisma.$transaction([
    prisma.subscription.update({
      where: { hospitalId: id },
      data: {
        ...changes,
        currentPeriodStart: changes.currentPeriodStart
          ? new Date(changes.currentPeriodStart)
          : undefined,
        currentPeriodEnd: changes.currentPeriodEnd ? new Date(changes.currentPeriodEnd) : undefined,
        managedBy: session!.user.id,
      },
    }),
    prisma.licenseAuditLog.create({
      data: {
        subscriptionId: existing.id,
        action: changes.status ? `STATUS_CHANGED_TO_${changes.status}` : 'UPDATED',
        previousStatus: existing.status,
        newStatus: (changes.status ?? existing.status) as string,
        performedBy: session!.user.id,
        notes: changes.notes ?? `Updated by SUPER_ADMIN: ${session!.user.email}`,
        metadata: { changes } as object,
      },
    }),
  ])
  const updated = (result as unknown[])[0]

  return NextResponse.json(updated)
}
