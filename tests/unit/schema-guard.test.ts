import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Permanent guard for the two regressions that kept sneaking back into
 * prisma/schema.prisma:
 *
 *   1. invalid Prisma relation-action spellings ("Set Null", "No Action",
 *      "Set Default" with a space) — the valid forms are SetNull / NoAction /
 *      SetDefault. The invalid ones make `prisma generate`/`validate` fail.
 *   2. duplicate `enum` / `model` declarations (e.g. two `enum MessageStatus`
 *      blocks) — Prisma requires declaration names to be unique.
 *
 * This file runs in CI as part of `npx vitest run`, so any future commit that
 * reintroduces either problem fails the suite before it can be pushed.
 */

const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')

describe('prisma schema guard', () => {
  it('has no invalid relation-action spellings (spaced forms)', () => {
    expect(schema).not.toMatch(/onDelete:\s*Set\s+Null/)
    expect(schema).not.toMatch(/:\s*No\s+Action\b/)
    expect(schema).not.toMatch(/:\s*Set\s+Default\b/)
  })

  it('uses the valid relation actions somewhere (sanity: file is really the schema)', () => {
    expect(schema).toMatch(/onDelete:\s*(SetNull|Cascade|Restrict|NoAction|SetDefault)/)
  })

  it('declares every enum and model exactly once (no duplicates)', () => {
    const declarations = [...schema.matchAll(/^(enum|model)\s+(\w+)/gm)].map((m) => m[2])
    const seen = new Set<string>()
    const duplicates = declarations.filter((name) => {
      if (seen.has(name)) return true
      seen.add(name)
      return false
    })
    expect(duplicates, `duplicate declarations: ${duplicates.join(', ')}`).toEqual([])
  })

  it('has at most one MessageStatus-style enum per name (regression: MessageStatus)', () => {
    const messageStatusBlocks = schema.match(/^enum\s+Message\w*Status\s*\{/gm) ?? []
    expect(messageStatusBlocks.length).toBeLessThanOrEqual(2) // MessageStatus + MessageQueueStatus
    expect(schema.match(/^enum\s+MessageStatus\s*\{/gm) ?? []).toHaveLength(1)
  })

  it('has balanced curly braces (no truncated edits)', () => {
    const open = (schema.match(/\{/g) ?? []).length
    const close = (schema.match(/\}/g) ?? []).length
    expect(open).toBe(close)
    expect(open).toBeGreaterThan(0)
  })
})
