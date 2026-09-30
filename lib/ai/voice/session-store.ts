/**
 * Phase 10 — process-wide VoiceSessionStore singleton.
 *
 * In-memory reference implementation (ephemeral interaction state only).
 * Phase 11 interface: swap for a durable store behind the same
 * VoiceSessionStore contract — the pipeline never sees this module.
 */

import { InMemoryVoiceSessionStore } from './session'

const globalStore = globalThis as unknown as { __dentoraVoiceSessions?: InMemoryVoiceSessionStore }

export function voiceSessions(): InMemoryVoiceSessionStore {
  if (!globalStore.__dentoraVoiceSessions) {
    globalStore.__dentoraVoiceSessions = new InMemoryVoiceSessionStore()
  }
  return globalStore.__dentoraVoiceSessions
}
