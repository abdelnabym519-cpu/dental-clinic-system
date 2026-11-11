'use client'

/**
 * P4 / step 3 — the `?perf=1` overlay metrics.
 *
 * Four numbers, chosen to be readable at a glance and comparable between the
 * two scenes:
 *
 *   initialBytes      bytes fetched before the first frame (0 under
 *                     ASSET_MODE=none — if it is non-zero, an asset slipped
 *                     past the mode gate)
 *   timeToFirstFrame  ms from mount() to the first rendered frame
 *   fps               sustained frame rate while ORBITING (not idle)
 *   jsHeapMB          used JS heap (a proxy only — GPU buffers live outside it)
 */

export interface PerfSample {
  initialBytes: number
  timeToFirstFrameMs: number | null
  fps: number | null
  jsHeapMB: number | null
}

export interface PerfTracker {
  /** Call once, before mounting the scene. */
  start(): void
  /** Call from a rAF loop once the scene is live; first call sets TTF. */
  tick(): void
  /** Mark that the user is orbiting (starts/keeps the FPS window). */
  markOrbiting(): void
  sample(): PerfSample
  stop(): void
}

interface MemoryInfo {
  usedJSHeapSize: number
}

function heapMB(): number | null {
  const perf = performance as Performance & { memory?: MemoryInfo }
  if (!perf.memory || typeof perf.memory.usedJSHeapSize !== 'number') return null
  return Math.round((perf.memory.usedJSHeapSize / (1024 * 1024)) * 10) / 10
}

/** Bytes fetched so far, via the Resource Timing API where available. */
function transferredBytes(): number {
  if (typeof performance.getEntriesByType !== 'function') return 0
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  let total = 0
  for (const e of entries) {
    // transferSize is 0 for cross-origin resources without Timing-Allow-Origin.
    total += typeof e.transferSize === 'number' && e.transferSize > 0 ? e.transferSize : 0
  }
  return total
}

export function createPerfTracker(): PerfTracker {
  let startedAt = 0
  let baselineBytes = 0
  let firstFrameMs: number | null = null
  let frames = 0
  let orbitFrames = 0
  let orbitStart = 0
  let lastOrbit = 0
  let fps: number | null = null
  let running = true

  return {
    start() {
      startedAt = performance.now()
      baselineBytes = transferredBytes()
      firstFrameMs = null
      frames = 0
      orbitFrames = 0
      orbitStart = 0
      fps = null
      running = true
    },
    tick() {
      if (!running) return
      frames++
      if (firstFrameMs === null) {
        firstFrameMs = Math.round((performance.now() - startedAt) * 10) / 10
      }
      // FPS is measured only while orbiting: an idle scene at 60fps proves
      // nothing about render cost under interaction.
      if (orbitStart > 0) {
        orbitFrames++
        const now = performance.now()
        if (now - lastOrbit >= 500) {
          fps = Math.round((orbitFrames / (now - orbitStart)) * 1000)
          orbitFrames = 0
          orbitStart = now
          lastOrbit = now
        }
        // Stop reporting if the user stopped interacting 1s ago.
        if (now - lastOrbit > 1000) orbitStart = 0
      }
    },
    markOrbiting() {
      const now = performance.now()
      if (orbitStart === 0) {
        orbitStart = now
        orbitFrames = 0
      }
      lastOrbit = now
    },
    sample(): PerfSample {
      return {
        // Bytes fetched since start — i.e. attributable to this scene.
        initialBytes: Math.max(0, transferredBytes() - baselineBytes),
        timeToFirstFrameMs: firstFrameMs,
        fps,
        jsHeapMB: heapMB(),
      }
    },
    stop() {
      running = false
    },
  }
}
