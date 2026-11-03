import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import * as realRao from 'rao-odontogram'

describe('vendor export contract (non-mock)', () => {
  const dtsPath = path.resolve(__dirname, '../../types/rao-odontogram.d.ts')
  const indexTsPath = path.resolve(__dirname, '../../vendor/react-advanced-odontogram/src/index.ts')

  it('declares and exports required runtime symbols', () => {
    const dtsContent = fs.readFileSync(dtsPath, 'utf8')

    // Extract runtime function declarations from .d.ts
    const fnRegex = /export\s+function\s+([A-Za-z0-9_]+)\s*\(/g
    const declaredFunctions: string[] = []
    let match: RegExpExecArray | null
    while ((match = fnRegex.exec(dtsContent)) !== null) {
      declaredFunctions.push(match[1])
    }

    expect(declaredFunctions).toContain('getToothStates')
    expect(declaredFunctions).toContain('resetForPatient')
    expect(declaredFunctions).toContain('setSelectedTeeth')
    expect(declaredFunctions).toContain('getSelectedTeeth')
    expect(declaredFunctions).toContain('importStatus')
    expect(declaredFunctions).toContain('onStateChange')

    // Verify all declared runtime functions exist on the real imported module
    for (const fnName of declaredFunctions) {
      expect(
        typeof (realRao as Record<string, unknown>)[fnName],
        `Expected ${fnName} to be exported as a function from real rao-odontogram entry`
      ).toBe('function')
    }
  })

  it('real module smoke test: critical functions are executable functions', () => {
    expect(typeof realRao.importStatus).toBe('function')
    expect(typeof realRao.getToothStates).toBe('function')
    expect(typeof realRao.onStateChange).toBe('function')
    expect(typeof realRao.resetForPatient).toBe('function')
    expect(typeof realRao.setSelectedTeeth).toBe('function')
    expect(typeof realRao.getSelectedTeeth).toBe('function')
    expect(typeof realRao.initOdontogram).toBe('function')
    expect(typeof realRao.destroyOdontogram).toBe('function')
    expect(realRao.OdontogramShell).toBeDefined()
    expect(realRao.default).toBeDefined()
  })
})
