import { describe, it, expect } from 'vitest'

import {
  findDuplicateEnvKeys,
  formatDuplicateKeyWarning,
  parseEnvFileContent,
} from '../../scripts/lib/dev-env'

/**
 * Duplicate `.env` keys — usually created by copying lines around. The file
 * stays legal, but which occurrence wins is invisible to whoever is editing
 * it, so the bootstrap and the dev starter now WARN: names only, never a
 * value (these files hold credentials), and they say which line wins.
 */
describe('findDuplicateEnvKeys', () => {
  it('finds nothing in a clean file', () => {
    expect(findDuplicateEnvKeys('A="1"\nB="2"\n')).toEqual([])
  })

  it('finds a key declared twice and reports every line', () => {
    const dupes = findDuplicateEnvKeys('A="1"\nB="2"\nA="3"\n')
    expect(dupes).toHaveLength(1)
    expect(dupes[0].key).toBe('A')
    expect(dupes[0].count).toBe(2)
    expect(dupes[0].lines).toEqual([1, 3])
  })

  it('the LAST non-empty occurrence wins — cross-checked against the real parser', () => {
    const content = 'A="first"\nA="second"\n'
    expect(findDuplicateEnvKeys(content)[0].winningLine).toBe(2)
    expect(parseEnvFileContent(content).A).toBe('second')
  })

  it('a later EMPTY occurrence does not win (the parser skips empties)', () => {
    const content = 'A="first"\nA=""\n'
    expect(findDuplicateEnvKeys(content)[0].winningLine).toBe(1)
    expect(parseEnvFileContent(content).A).toBe('first')
  })

  it('reports -1 when every occurrence is empty, i.e. the key is absent', () => {
    const content = 'A=""\nA=""\n'
    expect(findDuplicateEnvKeys(content)[0].winningLine).toBe(-1)
    expect(parseEnvFileContent(content).A).toBeUndefined()
  })

  it('handles three or more occurrences', () => {
    const dupes = findDuplicateEnvKeys('A="1"\nA="2"\nA="3"\n')
    expect(dupes[0].count).toBe(3)
    expect(dupes[0].winningLine).toBe(3)
  })

  it('ignores comments but honours the `export ` prefix', () => {
    expect(findDuplicateEnvKeys('#A="1"\nA="2"\n')).toEqual([])
    expect(findDuplicateEnvKeys('export A="1"\nA="2"\n')).toHaveLength(1)
  })

  it('tolerates CRLF', () => {
    const dupes = findDuplicateEnvKeys('A="1"\r\nA="2"\r\n')
    expect(dupes).toHaveLength(1)
    expect(dupes[0].lines).toEqual([1, 2])
  })

  it('returns duplicates in file order', () => {
    const dupes = findDuplicateEnvKeys('B="1"\nA="1"\nB="2"\nA="2"\n')
    expect(dupes.map((d) => d.key)).toEqual(['B', 'A'])
  })
})

describe('formatDuplicateKeyWarning', () => {
  it('names the key, the lines and the winner — and NEVER prints a value', () => {
    const content = 'S3_SECRET_KEY="hunter2"\nS3_SECRET_KEY="other-value"\n'
    const text = formatDuplicateKeyWarning('.env', findDuplicateEnvKeys(content)).join('\n')
    expect(text).toContain('S3_SECRET_KEY')
    expect(text).toContain('line 2 wins')
    expect(text).toContain('lines 1, 2')
    // The whole point: no credential ever reaches a log or a terminal.
    expect(text).not.toContain('hunter2')
    expect(text).not.toContain('other-value')
  })

  it('says ABSENT when every occurrence is empty', () => {
    const text = formatDuplicateKeyWarning('.env', findDuplicateEnvKeys('A=""\nA=""\n')).join('\n')
    expect(text).toContain('ABSENT')
  })

  it('states up front that no values are shown', () => {
    const lines = formatDuplicateKeyWarning('.env', findDuplicateEnvKeys('A="1"\nA="2"\n'))
    expect(lines[0]).toMatch(/names only/i)
    expect(lines[0]).toContain('.env')
  })

  it('is a no-op-shaped message for a clean file (callers guard on length)', () => {
    expect(findDuplicateEnvKeys('A="1"\n')).toHaveLength(0)
  })
})
