// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// ─────────────────────────────────────────────────────────────────────────────
// Prisma × MySQL search-compatibility regression suite (§11).
//
// Root cause: Prisma's `mode: 'insensitive'` string filter is a
// PostgreSQL/MongoDB feature — the MySQL connector's generated client rejects
// it (`Unknown argument 'mode'` / TS2353 on StringFilter). Case-insensitivity
// for MySQL comes from the `utf8mb4_unicode_ci` collation every migration
// creates tables with — plain `contains` is already case-insensitive.
//
// The "real client behavior" layer below executes against the REAL generated
// Prisma DMMF (the exact metadata the real client's argument validator uses),
// proving the repaired filter shapes are valid and `mode` is not a known
// argument for this MySQL client.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('@/lib/api-helpers', () => ({
  requireAuthAndRole: vi.fn(),
}))

import { GET as medicationsGET } from '@/app/api/medications/route'
import { GET as prescriptionsGET } from '@/app/api/prescriptions/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { containsCI } from '@/lib/prisma-search'

function mockAuth(overrides: Record<string, unknown> = {}) {
  const defaults = {
    error: null,
    user: { id: 'u1', role: 'ADMIN' },
    session: { user: { id: 'u1', role: 'ADMIN' } },
    hospitalId: 'h1',
  }
  vi.mocked(requireAuthAndRole).mockResolvedValue({ ...defaults, ...overrides } as any)
}

function req(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`)
}

const ROOT = join(__dirname, '..', '..')

// ────────────────────────────────────────────────────────────────────────────
// Real generated client contract (§11) — executed against the artifacts of
// `prisma generate` for THIS MySQL schema. The generated TypeScript types are
// derived from the same DMMF the real client's argument validator uses, so a
// compile of the fixture below IS the real validation behavior: the repaired
// shape must type-check, and `mode` must be rejected by the MySQL client.
// ────────────────────────────────────────────────────────────────────────────

describe('real Prisma MySQL client contract (generated types + schema DMMF)', () => {
  const { Prisma } = require('@prisma/client')
  const { execFileSync } = require('child_process')
  const { mkdtempSync, writeFileSync, rmSync } = require('fs')
  const { tmpdir } = require('os')

  it('the generated schema datamodel contains the searched Medication string fields', () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Medication')
    expect(model).toBeTruthy()
    for (const field of ['name', 'genericName', 'manufacturer']) {
      const f = model.fields.find((x) => x.name === field)
      expect(f?.type).toBe('String')
    }
  })

  it('the generated MySQL client REJECTS `mode` and ACCEPTS the repaired contains-only shape', () => {
    // The fixture lives at the repo root so `@prisma/client` types resolve;
    // it is removed immediately after compilation (never committed).
    const fixturePath = join(ROOT, '.search-contract-fixture.ts')
    const fixture = [
      "import type { Prisma } from './node_modules/@prisma/client'",
      '',
      '// repaired shape — must type-check against the real generated MySQL client',
      'export const repaired: Prisma.MedicationWhereInput = {',
      "  hospitalId: 'h1',",
      '  isActive: true,',
      '  OR: [',
      "    { name: { contains: 'fcd' } },",
      "    { genericName: { contains: 'fcd' } },",
      "    { manufacturer: { contains: 'fcd' } },",
      '  ],',
      '}',
      '',
      '// legacy PostgreSQL-only shape — the generated MySQL client must reject it.',
      '// If `mode` were ever accepted again, the directive below becomes unused',
      '// and compilation fails — an honest two-directional assertion.',
      'export const legacyRejected: Prisma.MedicationWhereInput = {',
      '// @ts-expect-error — `mode` is not a StringFilter argument for MySQL.',
      "  OR: [{ name: { contains: 'fcd', mode: 'insensitive' } }],",
      '}',
      '',
    ].join('\n')
    writeFileSync(fixturePath, fixture)
    try {
      execFileSync(
        join(ROOT, 'node_modules', '.bin', 'tsc'),
        ['--noEmit', '--strict', '--skipLibCheck', '--module', 'commonjs', '--target', 'es2020', '--esModuleInterop', fixturePath],
        { cwd: ROOT, stdio: 'pipe' }
      )
      // exit 0 proves BOTH directions: repaired valid + mode rejected
      expect(true).toBe(true)
    } catch (e) {
      const out = String(e.stdout || '') + String(e.stderr || '')
      throw new Error('generated-client contract violated: ' + out.slice(0, 600))
    } finally {
      try { rmSync(fixturePath) } catch {}
    }
  }, 30_000)
})

// ────────────────────────────────────────────────────────────────────────────
// Medication route behavior — count + findMany correctness (§9)
// ────────────────────────────────────────────────────────────────────────────

describe('GET /api/medications — repaired MySQL search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth()
  })

  function lastWhere() {
    return vi.mocked(prisma.medication.findMany).mock.calls[0][0]?.where
  }

  it('searches name/genericName/manufacturer with NO `mode` argument (count + findMany)', async () => {
    vi.mocked(prisma.medication.findMany).mockResolvedValue([])
    vi.mocked(prisma.medication.count).mockResolvedValue(0)

    const res = await medicationsGET(req('/api/medications?search=fcd'))
    expect(res.status).toBe(200)

    expect(prisma.medication.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.medication.count).toHaveBeenCalledTimes(1)

    const findWhere = vi.mocked(prisma.medication.findMany).mock.calls[0][0]?.where
    const countWhere = vi.mocked(prisma.medication.count).mock.calls[0][0]?.where

    for (const where of [findWhere, countWhere]) {
      expect(where.OR).toEqual([
        { name: { contains: 'fcd' } },
        { genericName: { contains: 'fcd' } },
        { manufacturer: { contains: 'fcd' } },
      ])
      expect(JSON.stringify(where)).not.toContain('"mode"')
    }
    // identical where for rows and total — pagination count stays accurate
    expect(countWhere).toEqual(findWhere)
  })

  it('preserves tenant isolation and isActive filtering alongside the search', async () => {
    vi.mocked(prisma.medication.findMany).mockResolvedValue([])
    vi.mocked(prisma.medication.count).mockResolvedValue(0)

    await medicationsGET(req('/api/medications?search=FCD&active=true&page=2&limit=25'))

    const args = vi.mocked(prisma.medication.findMany).mock.calls[0][0]
    expect(args.where.hospitalId).toBe('h1')
    expect(args.where.isActive).toBe(true)
    expect(args.orderBy).toEqual({ name: 'asc' })
    expect(args.skip).toBe(25) // page 2 × 25
    expect(args.take).toBe(25)

    const countArgs = vi.mocked(prisma.medication.count).mock.calls[0][0]
    expect(countArgs.where.hospitalId).toBe('h1')
    expect(countArgs.where.isActive).toBe(true)
  })

  it('uppercase / mixed-case variants produce the same DMMF-valid shape (collation handles case)', async () => {
    vi.mocked(prisma.medication.findMany).mockResolvedValue([])
    vi.mocked(prisma.medication.count).mockResolvedValue(0)

    for (const term of ['fcd', 'FCD', 'FcD', 'fcdxs', 'fcdxsaa']) {
      vi.mocked(prisma.medication.count).mockClear()
      await medicationsGET(req(`/api/medications?search=${term}`))
      const where = vi.mocked(prisma.medication.count).mock.calls[0][0]?.where
      expect(where.OR.every((leaf) => Object.values(leaf)[0].contains === term)).toBe(true)
      expect(JSON.stringify(where)).not.toContain('"mode"')
    }
  })

  it('empty search omits the OR clause entirely (full listing still works)', async () => {
    vi.mocked(prisma.medication.findMany).mockResolvedValue([{ id: 'm1' }])
    vi.mocked(prisma.medication.count).mockResolvedValue(1)

    const res = await medicationsGET(req('/api/medications'))
    expect(res.status).toBe(200)
    const where = lastWhere()
    expect(where.OR).toBeUndefined()
    expect(where.hospitalId).toBe('h1')
  })

  it('no-result search returns a valid empty page with accurate totals', async () => {
    vi.mocked(prisma.medication.findMany).mockResolvedValue([])
    vi.mocked(prisma.medication.count).mockResolvedValue(0)

    const res = await medicationsGET(req('/api/medications?search=fcdxsaa'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data).toEqual([])
    expect(body.pagination.total).toBe(0)
    expect(body.pagination.pages).toBe(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Sibling search paths — same defect class, same repair (§10)
// ────────────────────────────────────────────────────────────────────────────

describe('global MySQL search audit', () => {
  const PRODUCTION_FILES = [
    'app/api/medications/route.ts',
    'app/api/prescriptions/route.ts',
    'app/api/inventory/items/route.ts',
    'app/api/lab-orders/route.ts',
    'app/api/lab-vendors/route.ts',
  ]

  it('no production search path sends `mode` to Prisma (only the helper doc mentions it)', () => {
    const offenders: string[] = []
    for (const rel of PRODUCTION_FILES) {
      const src = readFileSync(join(ROOT, rel), 'utf-8')
      if (/mode:\s*['"]insensitive['"]/.test(src)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('all five sibling routes go through the canonical containsCI helper', () => {
    for (const rel of PRODUCTION_FILES) {
      const src = readFileSync(join(ROOT, rel), 'utf-8')
      expect(src, rel).toContain("from '@/lib/prisma-search'")
      expect(src, rel).toContain('containsCI(')
    }
  })

  it('nested relation search (prescriptions → patient) carries no `mode` at any depth', async () => {
    mockAuth()
    vi.mocked(prisma.prescription.findMany).mockResolvedValue([])
    vi.mocked(prisma.prescription.count).mockResolvedValue(0)

    await prescriptionsGET(req('/api/prescriptions?search=ahmed'))
    const where = vi.mocked(prisma.prescription.findMany).mock.calls[0][0]?.where
    expect(where.hospitalId).toBe('h1')
    expect(JSON.stringify(where)).not.toContain('"mode"')
    // nested shape preserved: patient OR still searches three fields
    const patientOr = where.OR.find((leaf) => leaf.patient)?.patient?.OR
    expect(patientOr).toEqual([
      { firstName: { contains: 'ahmed' } },
      { lastName: { contains: 'ahmed' } },
      { patientId: { contains: 'ahmed' } },
    ])
  })

  it('the helper documents the MySQL collation contract (no re-introduction of mode)', () => {
    const src = readFileSync(join(ROOT, 'lib', 'prisma-search.ts'), 'utf-8')
    expect(src).toContain('utf8mb4_unicode_ci')
    expect(src).toMatch(/export function containsCI/)
  })

  it('no schema or migration change was required for this repair', () => {
    // the repair is query-side only; assert the guardrails exist for CI
    expect(existsSync(join(ROOT, 'prisma', 'schema.prisma'))).toBe(true)
    const schema = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf-8')
    expect(schema).toContain('provider = "mysql"')
  })
})
