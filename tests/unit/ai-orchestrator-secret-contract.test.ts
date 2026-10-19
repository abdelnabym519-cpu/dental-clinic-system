// @ts-nocheck
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * WS-B: the app ↔ orchestrator authentication contract has ONE secret name.
 *
 * Historical defect: the .env value and the running orchestrator container's
 * value diverged (container created before the .env was repaired). These pins
 * make the single-source contract structural so a future rename cannot
 * silently re-introduce the divergence:
 *   .env ──► Next.js process.env.ORCHESTRATOR_SECRET  (app transport header)
 *   .env ──► compose interpolation ${ORCHESTRATOR_SECRET:?} (container env)
 *   container env ──► main.py compare_digest(X-Orchestrator-Secret)
 */

const read = (p: string) => readFileSync(p, 'utf8')

describe('WS-B: orchestrator secret single-source contract', () => {
  it('every app-side consumer reads process.env.ORCHESTRATOR_SECRET (no alternate names)', () => {
    const consumers = ['lib/ai/engines/orchestrator-source.ts', 'lib/ai-orchestrator.ts']
    for (const f of consumers) {
      const src = read(f)
      expect(src, f).toContain('process.env.ORCHESTRATOR_SECRET')
      expect(src, f).toMatch(/X-Orchestrator-Secret/)
    }
    // the app-side fail-closed error message is the user-reported contract
    expect(read('lib/ai/engines/orchestrator-source.ts')).toContain(
      "'ORCHESTRATOR_SECRET is not configured'"
    )
  })

  it('the orchestrator container receives the SAME variable via compose interpolation', () => {
    const compose = read('ai-compose.yml')
    expect(compose).toMatch(/ORCHESTRATOR_SECRET:\s*\$\{ORCHESTRATOR_SECRET:\?/)
  })

  it('the orchestrator verifies the header in constant time and fails closed', () => {
    const py = read('ai/orchestrator/app/main.py')
    expect(py).toContain('hmac.compare_digest')
    expect(py).toContain('invalid orchestrator secret')
    expect(py).toMatch(/ORCHESTRATOR_SECRET/)
  })

  it('the bootstrap guarantees the secret so app and container resolve the same value', () => {
    const setup = read('scripts/lib/setup-dev.ts')
    expect(setup).toContain("'ORCHESTRATOR_SECRET'")
  })
})
