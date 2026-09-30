/**
 * Phase 7 — environment labeling for performance evidence (§18).
 *
 * NEVER label sandbox performance as target-hardware performance. The label
 * is explicit: an operator may set `EVAL_ENV_LABEL` (one of ENV_LABELS);
 * otherwise a conservative heuristic applies. Target-machine numbers may be
 * claimed ONLY when the label is TARGET_MACHINE (i.e., actually measured
 * there — or explicitly attested by the operator via the env var).
 */
import os from 'node:os'
import type { EnvLabel, EnvironmentFacts } from './types'
import { ENV_LABELS } from './types'

const TARGET_HOST_HINTS = ['dentora-target', 'dento-target']

export function isEnvLabel(value: unknown): value is EnvLabel {
  return typeof value === 'string' && (ENV_LABELS as readonly string[]).includes(value)
}

export function detectEnvLabel(): { label: EnvLabel; source: 'env-var' | 'heuristic' } {
  const fromEnv = process.env.EVAL_ENV_LABEL
  if (isEnvLabel(fromEnv)) return { label: fromEnv, source: 'env-var' }
  // Heuristics (conservative — anything uncertain is UNKNOWN, never
  // silently claimed as the target machine).
  const host = os.hostname().toLowerCase()
  if (TARGET_HOST_HINTS.some((h) => host.includes(h))) return { label: 'TARGET_MACHINE', source: 'heuristic' }
  if (
    process.env.E2B_SANDBOX === 'true' ||
    process.env.EVAL_SANDBOX === '1' ||
    host.startsWith('sandbox') ||
    (os.cpus().length <= 2 && os.totalmem() < 5 * 1024 ** 3)
  ) {
    return { label: 'SANDBOX', source: 'heuristic' }
  }
  return { label: 'UNKNOWN', source: 'heuristic' }
}

export function environmentFacts(): EnvironmentFacts {
  const { label, source } = detectEnvLabel()
  const cpus = os.cpus()
  return {
    label,
    node: process.version,
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model ?? 'unknown',
    totalMemGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    labelSource: source,
  }
}

/** Guard used by performance tests: a benchmark record must carry facts. */
export function assertLabeled(env: EnvironmentFacts): string | null {
  if (!isEnvLabel(env.label)) return `unlabeled environment: ${String(env.label)}`
  if (!env.node || !env.cpuCount) return 'incomplete environment facts'
  return null
}
