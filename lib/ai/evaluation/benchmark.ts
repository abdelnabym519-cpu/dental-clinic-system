/**
 * Phase 7 — reproducible performance evaluation (§18).
 *
 * Measures Unit / Integration / Agent / RAG / Multimodal / Local AI /
 * End-to-End separately. Every record carries explicit environment facts
 * and a label — sandbox numbers are NEVER labeled as target-hardware
 * numbers. Latency is split where the architecture allows (infra vs model).
 */
import { assertLabeled, environmentFacts } from './environment'
import type { BenchmarkRecord, EnvironmentFacts } from './types'

export interface BenchmarkOptions {
  warmup?: number
  samples?: number
  notes?: string | null
  /** Override environment facts (e.g., an explicitly attested label). */
  env?: EnvironmentFacts
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

/**
 * Run `fn` (warmup + samples), measuring each call. Failures inside `fn`
 * are counted, not thrown — a benchmark reports its failure count rather
 * than hiding it. Returns the labeled record.
 */
export async function benchmark<T>(
  name: string,
  fn: () => Promise<T>,
  opts: BenchmarkOptions = {},
): Promise<BenchmarkRecord> {
  const env = opts.env ?? environmentFacts()
  const warmup = opts.warmup ?? 3
  const samples = opts.samples ?? 11
  const times: number[] = []
  let cold: number | null = null
  let failures = 0
  for (let i = 0; i < warmup + samples; i++) {
    const t0 = process.hrtime.bigint()
    try {
      await fn()
    } catch {
      failures += 1
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    if (i === 0) cold = ms
    if (i >= warmup) times.push(ms)
  }
  const sorted = [...times].sort((a, b) => a - b)
  const mean = times.reduce((s, x) => s + x, 0) / Math.max(1, times.length)
  const record: BenchmarkRecord = {
    name,
    env,
    runs: { warmup, samples },
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    meanMs: Math.round(mean * 100) / 100,
    medianMs: Math.round(percentile(sorted, 50) * 100) / 100,
    p95Ms: Math.round(percentile(sorted, 95) * 100) / 100,
    coldMs: cold !== null ? Math.round(cold * 100) / 100 : null,
    failures,
    notes: opts.notes ?? null,
  }
  return record
}

/** Guard for test assertions: the record must be labeled + measurable. */
export function validateBenchmarkRecord(r: BenchmarkRecord): string | null {
  const envProblem = assertLabeled(r.env)
  if (envProblem) return envProblem
  if (r.runs.samples < 5) return 'insufficient samples (<5)'
  if (Number.isNaN(r.medianMs) || r.medianMs < 0) return 'invalid median'
  return null
}
