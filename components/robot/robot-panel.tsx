'use client'

/**
 * Robot panel — the unified AI interaction surface: voice + text + transcript + approval.
 *
 * Everything shown comes from the canonical typed APIs:
 *  - voice turns → /api/ai/voice/turn (server pipeline → agent)
 *  - approvals   → /api/ai/approvals/[id] (Phase 1 ledger — explicit,
 *                  attributable, cancellable; keyboard-operable buttons,
 *                  NEVER a gesture, §32/§33)
 *  - context     → session-scoped fields returned by the pipeline
 *
 * Accessibility (§26): voice is never the only method — text input uses the
 * SAME session/pipeline; every robot state has visible text + ARIA live
 * regions; all controls are keyboard reachable with focus rings; animations
 * honor prefers-reduced-motion.
 *
 * Responsive (§27): single-column on mobile, robot + transcript side-by-side
 * from md; kiosk size scales the robot up (reception/kiosk tablet usage).
 */

import { useLanguage } from '@/components/providers/language-provider'
import { cn } from '@/lib/utils'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DentoraRobot } from './dentora-robot'
import { useDentoraVoice } from '@/hooks/use-dentora-voice'

type Kioskish = 'md' | 'lg' | 'kiosk'

export function RobotPanel({ kiosk = false }: { kiosk?: boolean }) {
  const { t, locale } = useLanguage()
  const voiceLocale: 'ar-EG' | 'en-US' = locale === 'ar-EG' ? 'ar-EG' : 'en-US'
  const [textValue, setTextValue] = useState('')

  const voice = useDentoraVoice({
    locale: voiceLocale,
    onClarification: () => {
      /* clarification renders from state */
    },
  })

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [voice.turns.length, voice.interim])

  const submitText = useCallback(() => {
    if (!textValue.trim()) return
    voice.sendText(textValue)
    setTextValue('')
  }, [textValue, voice])

  const statusLabel = statusLabelFor(voice.interactionState, t)
  const detail = voice.clarification
    ?? (voice.turns.length ? voice.turns[voice.turns.length - 1]!.content : null)

  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-5xl flex-col gap-4 p-4',
        kiosk && 'max-w-7xl p-8',
      )}
      data-testid="robot-panel"
    >
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground">{t('DenToRa Robot')}</h1>
          <p className="text-xs text-muted-foreground">
            {t('Voice and robot interface to the same DenToRa Agent')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => voice.setTtsEnabled(!voice.ttsEnabled)}
            aria-pressed={voice.ttsEnabled}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {voice.ttsEnabled ? t('Voice replies: On') : t('Voice replies: Off')}
          </button>
          <button
            type="button"
            onClick={() => voice.cancel()}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('Cancel session')}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Robot + voice controls */}
        <section
          aria-label={t('DenToRa Robot')}
          className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-gradient-to-b from-slate-50 to-slate-100 p-6 dark:from-slate-900 dark:to-slate-950"
        >
          <DentoraRobot
            state={voice.interactionState}
            statusLabel={statusLabel}
            detailText={voice.interim || detail}
            size={kiosk ? 'kiosk' : 'lg'}
          />

          <div className="flex items-center gap-3">
            {voice.listening ? (
              <button
                type="button"
                onClick={voice.stopListening}
                className="rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {t('Stop listening')}
              </button>
            ) : (
              <button
                type="button"
                onClick={voice.startListening}
                disabled={!voice.supported}
                aria-label={t('Start voice input')}
                className="rounded-full bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                🎙 {t('Talk to DenToRa')}
              </button>
            )}
            <button
              type="button"
              onClick={voice.interrupt}
              aria-label={t('Interrupt')}
              className="rounded-full border border-border bg-background px-4 py-2.5 text-sm font-medium hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('Interrupt')}
            </button>
          </div>
          {!voice.supported && (
            <p className="text-center text-xs text-muted-foreground" role="note">
              {t('Voice capture is not available in this browser — you can type below; DenToRa answers through the same agent.')}
            </p>
          )}
          {voice.error && (
            <p className="text-center text-xs font-medium text-red-600 dark:text-red-400" role="alert">
              {t('Voice error')}: {voice.error}
            </p>
          )}
        </section>

        {/* Transcript + response + approval */}
        <section className="flex min-h-[420px] flex-col gap-3 rounded-2xl border border-border bg-background p-4">
          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto rounded-xl bg-muted/30 p-3"
            aria-live="polite"
            aria-relevant="additions text"
            aria-label={t('Conversation transcript')}
            data-testid="voice-transcript"
          >
            {voice.turns.length === 0 && !voice.interim && (
              <p className="text-sm text-muted-foreground">
                {t('Say a command or type it — for example')}{' '}
                <span dir="rtl">“إيه الحالات اللي محتاجة مراجعة النهارده؟”</span>
              </p>
            )}
            {voice.turns.map((turn, i) => (
              <div key={`${turn.at}-${i}`} className={cn('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                    turn.role === 'user'
                      ? 'bg-sky-600 text-white'
                      : 'border border-border bg-background text-foreground',
                  )}
                >
                  <span className="sr-only">{turn.role === 'user' ? t('You') : t('DenToRa')}: </span>
                  <p className="whitespace-pre-wrap">{turn.content}</p>
                </div>
              </div>
            ))}
            {voice.interim && (
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl bg-sky-600/50 px-3.5 py-2 text-sm text-white" aria-hidden="true">
                  {voice.interim}…
                </div>
              </div>
            )}
          </div>

          {/* Approval card — explicit, attributable, cancellable (§32/§33) */}
          {voice.approval && (
            <div
              className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-950/30"
              role="region"
              aria-label={t('Approval required')}
              data-testid="voice-approval-card"
            >
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                {t('Approval required')}
              </p>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                {t('Action')}: <code className="font-mono">{voice.approval.action}</code> · {t('Risk')}:{' '}
                {voice.approval.riskLevel}
              </p>
              {Object.keys(voice.approval.params).length > 0 && (
                <ul className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                  {Object.entries(voice.approval.params).map(([k, v]) => (
                    <li key={k}>
                      <span className="font-mono">{k}</span>: {v}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => voice.decideApproval(voice.approval!.approvalId, 'approve')}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('Send to approvals (approve)')}
                </button>
                <button
                  type="button"
                  onClick={() => voice.decideApproval(voice.approval!.approvalId, 'reject')}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('Reject')}
                </button>
                <button
                  type="button"
                  onClick={() => voice.decideApproval(voice.approval!.approvalId, 'cancel')}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('Cancel')}
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                {t('Final approval follows the role-separated approval policy — voice confirmation only flags your request.')}
              </p>
            </div>
          )}

          {/* Text fallback input (§26 — voice never the only method) */}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              submitText()
            }}
          >
            <label htmlFor="dentora-voice-text" className="sr-only">
              {t('Type a message for DenToRa')}
            </label>
            <input
              id="dentora-voice-text"
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder={t('Type a message for DenToRa')}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              disabled={!textValue.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('Send')}
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}

function statusLabelFor(s: string, t: (k: string) => string): string {
  switch (s) {
    case 'IDLE': return t('DenToRa is idle')
    case 'LISTENING': return t('DenToRa is listening')
    case 'TRANSCRIBING': return t('Transcribing your speech')
    case 'UNDERSTANDING': return t('Understanding your request')
    case 'PROCESSING': return t('DenToRa is thinking')
    case 'WAITING_APPROVAL': return t('Waiting for your approval')
    case 'SPEAKING': return t('DenToRa is speaking')
    case 'INTERRUPTED': return t('Interrupted — I am listening')
    case 'WARNING': return t('Warning — please review')
    case 'ERROR': return t('Something went wrong')
    case 'COMPLETED': return t('Done')
    case 'CANCELLED': return t('Session cancelled')
    default: return t('DenToRa is idle')
  }
}

/** Kiosk wrapper (reception tablet / lobby screen — §27). */
export function RobotKioskView() {
  return <RobotPanel kiosk />
}

export function RobotPanelWithSize({ size }: { size: Kioskish }) {
  return <RobotPanel kiosk={size === 'kiosk'} />
}
