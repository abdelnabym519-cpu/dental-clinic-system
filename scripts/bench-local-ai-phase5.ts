/**
 * Phase 5 — Local AI performance benchmark summary (§27).
 *
 * What this script IS:
 *   A deterministic, offline summarizer over the COMMITTED real-inference
 *   evidence reports (ai-validation/meshsegnet/reports/phase5_real_inference_*.json).
 *   It produces a single machine-readable benchmark artifact that separates:
 *     - infrastructure baseline (hardware-dependent, sandbox values)
 *     - model characteristics (parameter count, load time — hardware-independent)
 *   and states explicitly that NOTHING here implies clinical accuracy.
 *
 * What this script is NOT:
 *   It does not run inference (the real runs are the evidence reports),
 *   it does not claim accuracy, and it never re-labels synthetic output
 *   as a benchmark.
 *
 * Usage: npx tsx scripts/bench-local-ai-phase5.ts
 * Exit codes: 0 = summary written; 1 = evidence missing/invalid.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = join(__dirname, '..')
const REPORT_DIR = join(ROOT, 'ai-validation', 'meshsegnet', 'reports')
const OUT = join(REPORT_DIR, 'phase5_benchmark_summary.json')

interface EvidenceReport {
  engine: string
  status: string
  model: { parameter_count?: number; load_time_ms?: number; sha256: string }
  health_gate: { model_load_time_ms: number; parameter_count: number; is_standin: boolean }
  preprocessing: { cells_original: number; inference_cells: number; engine_processing_time_ms: number }
  performance_ms: {
    cold_first_inference: number
    warm_median_of_5: number
    warm_all: number[]
    note?: string
  }
  memory: { engine_process_peak_rss_mb: number }
  runtime: { execution_provider: string; cuda_available: boolean; host: string; python: string; torch: string }
  determinism_check: { labels_identical_cold_vs_warm: boolean; segments_identical_cold_vs_warm: boolean }
}

function loadAll(): EvidenceReport[] {
  const out: EvidenceReport[] = []
  for (const jaw of ['max', 'man']) {
    const p = join(REPORT_DIR, `phase5_real_inference_${jaw}.json`)
    if (!existsSync(p)) {
      console.error(`MISSING evidence report: ${p}`)
      process.exit(1)
    }
    const r = JSON.parse(readFileSync(p, 'utf8')) as EvidenceReport
    if (r.status !== 'REAL_INFERENCE_VERIFIED') {
      console.error(`EVIDENCE INVALID: ${p} status=${r.status}`)
      process.exit(1)
    }
    out.push(r)
  }
  return out
}

function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return 0
  const idx = (sorted.length - 1) * q
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function main() {
  const reports = loadAll()
  const perEngine = reports.map((r) => {
    const warm = [...r.performance_ms.warm_all].sort((a, b) => a - b)
    return {
      engine: r.engine,
      engine_code: `ai/engines/${r.engine}`,
      // ── model characteristics (hardware-independent) ──
      model: {
        parameter_count: r.health_gate.parameter_count,
        model_load_time_ms: r.health_gate.model_load_time_ms,
        checksum_verified: !r.health_gate.is_standin,
      },
      // ── infrastructure baseline (sandbox hardware — NOT the target machine) ──
      performance_ms: {
        cold_first_inference: r.performance_ms.cold_first_inference,
        warm: {
          n: warm.length,
          min: warm[0],
          median: r.performance_ms.warm_median_of_5,
          p95: Number(percentile(warm, 0.95).toFixed(1)),
          max: warm[warm.length - 1],
        },
        decimated_cells: r.preprocessing.inference_cells,
        original_cells: r.preprocessing.cells_original,
      },
      memory_mb: { engine_process_peak_rss: r.memory.engine_process_peak_rss_mb },
      determinism: r.determinism_check,
      hardware: r.runtime.host,
      execution_provider: r.runtime.execution_provider,
    }
  })

  const summary = {
    kind: 'phase5_local_ai_benchmark_summary',
    generated_at: new Date().toISOString(),
    source: reports.map((r) => `ai-validation/meshsegnet/reports/phase5_real_inference_${r.engine.replace('meshsegnet-', '')}.json`),
    scope: 'INFRASTRUCTURE BASELINE ONLY',
    disclaimers: [
      'Numbers were measured in the Phase 5 validation sandbox (2 vCPU / ~4 GB RAM), NOT on the target Windows i9-13900H / 16 GB machine.',
      'Latency is an infrastructure characteristic of this model + hardware pair. It implies NOTHING about clinical accuracy (§27: accuracy is a separate, not-yet-validated axis).',
      'Clinical accuracy requires an evaluation dataset with reference annotations — out of scope for Phase 5 (deferred).',
    ],
    engines: perEngine,
  }

  mkdirSync(REPORT_DIR, { recursive: true })
  writeFileSync(OUT, JSON.stringify(summary, null, 2) + '\n')
  console.log(`wrote ${OUT}`)
  for (const e of perEngine) {
    console.log(
      `  ${e.engine}: cold ${e.performance_ms.cold_first_inference.toFixed(0)} ms | warm median ${e.performance_ms.warm.median.toFixed(0)} ms | p95 ${e.performance_ms.warm.p95.toFixed(0)} ms | peak RSS ${e.memory_mb.engine_process_peak_rss.toFixed(0)} MB | params ${e.model.parameter_count.toLocaleString()}`,
    )
  }
}

main()
