'use client'

/**
 * Phase 10 — canonical client voice hook (DenToRa Companion).
 *
 * Wires the browser to the SERVER voice pipeline:
 *   Web Speech recognition (client) → typed transcript → /api/ai/voice/turn
 *   → canonical InteractionState → TTS via speechSynthesis → Robot UI.
 *
 * Boundaries kept:
 *  - No clinical logic client-side: every turn goes through the server
 *    pipeline (validation → control phrases → entity resolution → agent).
 *  - Interim transcripts are DISPLAY-ONLY (never sent for action — §37).
 *  - Interruption (barge-in): stopping TTS + op=INTERRUPT keeps the session
 *    state machine authoritative (no duplicate actions).
 *  - Text input uses the SAME session/pipeline — voice is never the only
 *    interaction method (§26).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { InteractionState, VoiceTurnResponse } from '@/lib/ai/voice/types'
import { robotGreeting } from '@/lib/ai/robot-identity'
import { ttsLangForText } from '@/lib/ai/voice/language'

// ---------------------------------------------------------------------------
// Web Speech API (browser-native; typed locally — same approach as the
// text input uses the SAME session/pipeline (voice is never the only method).
// ---------------------------------------------------------------------------

interface SpeechRecognitionEventT extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}
interface SpeechRecognitionErrorEventT extends Event {
  error: string
}
type SpeechRecognitionInstanceT = EventTarget & {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechRecognitionEventT) => void) | null
  onerror: ((e: SpeechRecognitionErrorEventT) => void) | null
  onend: (() => void) | null
}

function getSpeechRecognition(): (new () => SpeechRecognitionInstanceT) | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as Record<string, unknown>).SpeechRecognition as
    | (new () => SpeechRecognitionInstanceT)
    | undefined
  || (window as unknown as Record<string, unknown>).webkitSpeechRecognition as
    | (new () => SpeechRecognitionInstanceT)
    | undefined
  || null
}

export interface DentoraVoiceTurn {
  role: 'user' | 'assistant'
  content: string
  at: string
  state?: InteractionState
}

interface UseDentoraVoiceOptions {
  locale: 'ar-EG' | 'en-US'
  /** Fired when the pipeline asks a clarification (focus attention). */
  onClarification?: (q: string) => void
}

export function useDentoraVoice({ locale, onClarification }: UseDentoraVoiceOptions) {
  const [interactionState, setInteractionState] = useState<InteractionState>('IDLE')
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [turns, setTurns] = useState<DentoraVoiceTurn[]>([])
  const [clarification, setClarification] = useState<string | null>(null)
  const [approval, setApproval] = useState<VoiceTurnResponse['approval']>(null)
  const [error, setError] = useState<string | null>(null)
  const [ttsEnabled, setTtsEnabled] = useState(true)

  const sessionRef = useRef<string | null>(null)
  const recogRef = useRef<SpeechRecognitionInstanceT | null>(null)
  const busyRef = useRef(false)
  // Late-bound speak() reference: speak is defined below ensureSession; the
  // ref lets the session bootstrap trigger the greeting without TDZ/deps
  // coupling (assigned on every render after speak exists).
  const speakRef = useRef<(text: string) => void>(() => {})
  const ttsEnabledRef = useRef(ttsEnabled)
  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled
  }, [ttsEnabled])

  useEffect(() => {
    setSupported(Boolean(getSpeechRecognition()) && typeof window !== 'undefined' && 'speechSynthesis' in window)
  }, [])

  // ---- Session lifecycle -------------------------------------------------
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionRef.current) return sessionRef.current
    try {
      const res = await fetch('/api/ai/voice/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale }),
      })
      if (!res.ok) return null
      const data = (await res.json()) as { session?: { voiceSessionId: string } }
      sessionRef.current = data.session?.voiceSessionId ?? null
      if (sessionRef.current) {
        // Canonical Robot opening greeting (hard product requirement) — shown
        // (and spoken, when voice replies are on) exactly once, at new-session
        // start, in the session language. Never prepended to other answers.
        const greeting = robotGreeting(locale)
        setTurns((t) => (t.length ? t : [...t, { role: 'assistant', content: greeting, at: new Date().toISOString() }]))
        if (ttsEnabledRef.current) speakRef.current(greeting)
      }
      return sessionRef.current
    } catch {
      return null
    }
  }, [locale])

  const endSession = useCallback(async () => {
    const id = sessionRef.current
    sessionRef.current = null
    if (!id) return
    try {
      await fetch(`/api/ai/voice/session?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    } catch {
      /* session GC will collect it server-side */
    }
  }, [])

  // ---- TTS (browser speechSynthesis; interruptible) -----------------------
  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  }, [])

  const speak = useCallback(
    (text: string) => {
      if (!ttsEnabledRef.current || typeof window === 'undefined' || !('speechSynthesis' in window)) return
      stopSpeaking()
      const u = new SpeechSynthesisUtterance(text)
      // Language consistency (§10/§14): the voice must match the language of
      // the text actually being spoken — Arabic text speaks with an Arabic
      // voice even mid-English-UI and vice versa.
      u.lang = ttsLangForText(text)
      u.onend = () => {
        // Playback finished — server state SPEAKING → COMPLETED.
        const id = sessionRef.current
        if (id) {
          fetch('/api/ai/voice/turn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voiceSessionId: id, op: 'PLAYBACK_ENDED' }),
          })
            .then((r) => (r.ok ? (r.json() as Promise<VoiceTurnResponse>) : null))
            .then((d) => {
              if (d) setInteractionState(d.state)
            })
            .catch(() => {})
        }
      }
      window.speechSynthesis.speak(u)
    },
    [locale, stopSpeaking],
  )
  useEffect(() => {
    speakRef.current = speak
  }, [speak])

  // ---- Turn posting --------------------------------------------------------
  const postTurn = useCallback(
    async (body: Record<string, unknown>, userTurnText: string | null) => {
      const sessionId = await ensureSession()
      if (!sessionId) {
        setError('VOICE_SESSION_UNAVAILABLE')
        setInteractionState('ERROR')
        return
      }
      busyRef.current = true
      setInteractionState((s) => (s === 'IDLE' || s === 'COMPLETED' ? 'LISTENING' : s))
      try {
        const res = await fetch('/api/ai/voice/turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voiceSessionId: sessionId, ...body }),
        })
        if (!res.ok) {
          setError(`VOICE_TURN_HTTP_${res.status}`)
          setInteractionState('ERROR')
          return
        }
        const data = (await res.json()) as VoiceTurnResponse
        if (userTurnText) {
          setTurns((t) => [...t.slice(-40), { role: 'user', content: userTurnText, at: new Date().toISOString() }])
        }
        setInteractionState(data.state)
        setApproval(data.approval)
        setClarification(data.clarification ? (locale === 'ar-EG' ? data.clarification.questionAr : data.clarification.questionEn) : null)
        if (data.error) setError(data.error.code)
        else setError(null)
        // Server-confirmed barge-in (§7): the turn arrived during active
        // speech — cancel TTS NOW so the doctor hears the answer, not the
        // tail of the interrupted sentence.
        if (data.interrupted) stopSpeaking()
        if (data.speakableText) {
          if (userTurnText) {
            setTurns((t) => [...t, { role: 'assistant', content: data.speakableText ?? '', at: new Date().toISOString(), state: data.state }])
          }
          setInteractionState(data.state)
          speak(data.speakableText)
        }
        if (data.clarification) onClarification?.(locale === 'ar-EG' ? data.clarification.questionAr : data.clarification.questionEn)
      } catch {
        setError('VOICE_TURN_NETWORK')
        setInteractionState('ERROR')
      } finally {
        busyRef.current = false
      }
    },
    [ensureSession, locale, onClarification, speak],
  )

  // ---- Recognition ---------------------------------------------------------
  // Turn-taking client contract (§5): the recognizer runs CONTINUOUSLY and
  // auto-restarts when the browser ends it — a short pause no longer kills
  // the listen (the server turn manager holds incomplete fragments and
  // combines them, so pause-finalized fragments still form ONE turn).
  // Natural barge-in: the recognizer keeps running while the robot speaks
  // (browser echo cancellation); the doctor's speech reaches the server as a
  // SPEAK turn during SPEAKING and the server's interruption contract
  // (interrupted:true) stops playback without destroying state.
  const wantListenRef = useRef(false)
  // Late-bound self-reference: the recognizer's onend restarts listening
  // (continuous turn-taking) without a TDZ self-closure.
  const startListeningRef = useRef<() => void>(() => {})
  const startListening = useCallback(() => {
    const SR = getSpeechRecognition()
    if (!SR) return
    wantListenRef.current = true
    if (recogRef.current) return // already listening (restart handles the rest)
    stopSpeaking()
    try {
      const recog = new SR()
      recogRef.current = recog
      recog.continuous = true
      recog.interimResults = true
      recog.lang = locale
      setInterim('')
      setListening(true)
      setInteractionState('LISTENING')
      recog.onresult = (e: SpeechRecognitionEventT) => {
        let finalText = ''
        let interimText = ''
        let confidence = 0
        let confidenceN = 0
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const r = e.results[i]
          const alt = r[0]
          if (r.isFinal) {
            finalText += alt?.transcript ?? ''
            const c = typeof alt?.confidence === 'number' && alt.confidence > 0 ? alt.confidence : null
            if (c != null) { confidence += c; confidenceN += 1 }
          } else {
            interimText += alt?.transcript ?? ''
          }
        }
        setInterim(interimText)
        if (finalText.trim()) {
          setInterim('')
          // Barge-in: cancel local TTS FIRST so the answer can be heard and
          // the interruption feels immediate (the server also reports it).
          if (interactionStateRef.current === 'SPEAKING') stopSpeaking()
          void postTurn(
            {
              op: 'SPEAK',
              transcript: {
                text: finalText.trim(),
                // The PROVIDER's own confidence (§13) — never a hardcoded
                // value: low-confidence ASR must be distinguishable
                // server-side (ASR failure-layer attribution).
                confidence: confidenceN > 0 ? Math.min(1, confidence / confidenceN) : 0,
                isFinal: true,
                providerId: 'web-speech-stt-browser',
                locale,
                capturedAt: new Date().toISOString(),
              },
            },
            finalText.trim(),
          )
        }
      }
      recog.onerror = (e: SpeechRecognitionErrorEventT) => {
        if (e.error !== 'aborted' && e.error !== 'no-speech') {
          setError(`STT_${e.error.toUpperCase()}`)
          setInteractionState('ERROR')
        } else if (interactionStateRef.current === 'LISTENING') {
          setInteractionState('IDLE')
        }
      }
      recog.onend = () => {
        setListening(false)
        // Auto-restart: continuous listening across the browser's own pauses
        // (§5-C — a short pause must not terminate the user's turn).
        if (wantListenRef.current) {
          window.setTimeout(() => {
            if (!wantListenRef.current || recogRef.current) return
            startListeningRef.current()
          }, 250)
        }
      }
      recog.start()
    } catch {
      setListening(false)
      setError('STT_START_FAILED')
      setInteractionState('ERROR')
    }
  }, [locale, postTurn, stopSpeaking])

  // Keep a ref of state for handlers (avoids stale closures in callbacks).
  const interactionStateRef = useRef<InteractionState>('IDLE')
  useEffect(() => {
    interactionStateRef.current = interactionState
  }, [interactionState])
  useEffect(() => {
    startListeningRef.current = startListening
  }, [startListening])

  const stopListening = useCallback(() => {
    wantListenRef.current = false
    recogRef.current?.abort()
    recogRef.current = null
    setListening(false)
    setInteractionState((s) => (s === 'LISTENING' ? 'IDLE' : s))
  }, [])

  const interrupt = useCallback(() => {
    stopSpeaking()
    const id = sessionRef.current
    setInteractionState('INTERRUPTED')
    if (id) {
      void postTurn({ op: 'INTERRUPT' }, null)
    }
  }, [postTurn, stopSpeaking])

  const cancel = useCallback(() => {
    wantListenRef.current = false
    stopSpeaking()
    stopListening()
    const id = sessionRef.current
    setInteractionState('CANCELLED')
    if (id) void postTurn({ op: 'CANCEL' }, null)
  }, [postTurn, stopListening, stopSpeaking])

  /** Text fallback — SAME session + pipeline (voice not the only method). */
  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || busyRef.current) return
      void postTurn(
        {
          op: 'SPEAK',
          transcript: {
            text: trimmed,
            confidence: 1,
            isFinal: true,
            providerId: 'text-input',
            locale,
            capturedAt: new Date().toISOString(),
          },
        },
        trimmed,
      )
    },
    [locale, postTurn],
  )

  /** Approval decision → existing approvals API (explicit UI action, §33). */
  const decideApproval = useCallback(
    async (approvalId: string, decision: 'approve' | 'reject' | 'cancel') => {
      try {
        await fetch(`/api/ai/approvals/${encodeURIComponent(approvalId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision }),
        })
        setApproval(null)
        setTurns((t) => [
          ...t,
          {
            role: 'assistant',
            content:
              decision === 'approve'
                ? locale === 'ar-EG'
                  ? 'تم إرسال الطلب لنظام الموافقات (حسب الصلاحيات).'
                  : 'Request submitted to the approval system (per policy roles).'
                : locale === 'ar-EG'
                  ? 'تم رفض الطلب.'
                  : 'Request rejected.',
            at: new Date().toISOString(),
            state: 'COMPLETED',
          },
        ])
        setInteractionState('COMPLETED')
      } catch {
        setError('APPROVAL_DECISION_FAILED')
      }
    },
    [locale],
  )

  // Cleanup recognition on unmount.
  useEffect(() => {
    return () => {
      wantListenRef.current = false
      recogRef.current?.abort()
    }
  }, [])

  return {
    // state
    interactionState,
    listening,
    interim,
    turns,
    clarification,
    approval,
    error,
    supported,
    ttsEnabled,
    // controls
    setTtsEnabled,
    startListening,
    stopListening,
    interrupt,
    cancel,
    sendText,
    decideApproval,
    endSession,
    sessionId: sessionRef.current,
  }
}
