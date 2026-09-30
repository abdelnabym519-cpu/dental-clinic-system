'use client'

/**
 * Phase 10 — DenToRa Robot: the visual/body layer of the SAME agent (§23–§27).
 *
 * Design direction: premium futuristic medical AI — white/silver body,
 * subtle dental-blue accents, expressive digital eyes, a subtle tooth motif,
 * friendly and professional. Never cartoonish, never scary.
 *
 * Accessibility (§26) is mandatory, not optional:
 *  - every state has accessible text + ARIA semantics (role="status",
 *    aria-live), the animation is decorative only;
 *  - keyboard accessible controls (the robot itself is not a button trap —
 *    interaction happens in the companion panel);
 *  - reduced-motion support via prefers-reduced-motion AND an explicit prop;
 *  - contrast-checked status colors (text labels always present).
 *
 * The component is presentation-only: states arrive from the canonical
 * InteractionState (lib/ai/voice/types) — the SAME state the voice session
 * uses. It never fakes "thinking": thinking is a real PROCESSING state.
 */

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { InteractionState } from '@/lib/ai/voice/types'

export type RobotState =
  | 'idle' | 'listening' | 'thinking' | 'speaking'
  | 'interrupted' | 'waiting-approval' | 'warning' | 'error' | 'success'

/** Canonical interaction state → robot visual state (one mapping, §34). */
export function robotStateFor(s: InteractionState): RobotState {
  switch (s) {
    case 'IDLE': return 'idle'
    case 'LISTENING': return 'listening'
    case 'TRANSCRIBING':
    case 'UNDERSTANDING':
    case 'PROCESSING': return 'thinking'
    case 'WAITING_APPROVAL': return 'waiting-approval'
    case 'SPEAKING': return 'speaking'
    case 'INTERRUPTED': return 'interrupted'
    case 'WARNING': return 'warning'
    case 'ERROR': return 'error'
    case 'COMPLETED': return 'success'
    case 'CANCELLED': return 'idle'
    default: return 'idle'
  }
}

export interface DentoraRobotProps {
  state: InteractionState
  /** Accessible status text (spoken state meaning) — REQUIRED. */
  statusLabel: string
  /** i18n-ready detail line (e.g. current clarification / response preview). */
  detailText?: string | null
  size?: 'sm' | 'md' | 'lg' | 'kiosk'
  /** Force-reduce animations (in addition to the OS preference). */
  reducedMotion?: boolean
  className?: string
}

const SIZE_PX: Record<NonNullable<DentoraRobotProps['size']>, number> = {
  sm: 96,
  md: 160,
  lg: 240,
  kiosk: 320,
}

const STATE_META: Record<RobotState, { eye: string; accent: string; glow: string }> = {
  idle: { eye: '#38BDF8', accent: '#E2E8F0', glow: 'rgba(56,189,248,0.25)' },
  listening: { eye: '#22D3EE', accent: '#A5F3FC', glow: 'rgba(34,211,238,0.45)' },
  thinking: { eye: '#818CF8', accent: '#C7D2FE', glow: 'rgba(129,140,248,0.35)' },
  speaking: { eye: '#34D399', accent: '#A7F3D0', glow: 'rgba(52,211,153,0.35)' },
  interrupted: { eye: '#FBBF24', accent: '#FDE68A', glow: 'rgba(251,191,36,0.35)' },
  'waiting-approval': { eye: '#F59E0B', accent: '#FDE68A', glow: 'rgba(245,158,11,0.4)' },
  warning: { eye: '#FB923C', accent: '#FED7AA', glow: 'rgba(251,146,60,0.4)' },
  error: { eye: '#F87171', accent: '#FECACA', glow: 'rgba(248,113,113,0.4)' },
  success: { eye: '#34D399', accent: '#A7F3D0', glow: 'rgba(52,211,153,0.3)' },
}

export function DentoraRobot({
  state,
  statusLabel,
  detailText,
  size = 'md',
  reducedMotion,
  className,
}: DentoraRobotProps) {
  const robot = robotStateFor(state)
  const meta = STATE_META[robot]
  const px = SIZE_PX[size]

  // OS-level reduced motion (CSS animations) — SSR-safe.
  const [osReduced, setOsReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setOsReduced(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setOsReduced(e.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  const still = Boolean(reducedMotion) || osReduced

  // Eyes blink occasionally in idle (life-like, subtle).
  const [blink, setBlink] = useState(false)
  useEffect(() => {
    if (robot !== 'idle' || still) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const loop = () => {
      timer = setTimeout(() => {
        if (!alive) return
        setBlink(true)
        setTimeout(() => {
          if (!alive) return
          setBlink(false)
          loop()
        }, 140)
      }, 2600 + Math.random() * 2600)
    }
    loop()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [robot, still])

  const anim = (name: string) => (still ? undefined : `${name} var(--robot-anim-dur, 1.8s) ease-in-out infinite`)

  return (
    <div
      className={cn('flex flex-col items-center gap-2', className)}
      data-testid="dentora-robot"
      data-robot-state={robot}
    >
      <div
        role="status"
        aria-live="polite"
        aria-label={statusLabel}
        className="relative select-none"
        style={{ width: px, height: px }}
      >
        {/* Ambient glow (decorative) */}
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-full blur-2xl"
          style={{ background: meta.glow, opacity: still ? 0.5 : 1, animation: anim('robot-breathe') }}
        />
        <svg
          viewBox="0 0 200 240"
          width={px}
          height={px}
          aria-hidden="true"
          className="relative drop-shadow-lg"
        >
          <defs>
            <linearGradient id="robotBody" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="55%" stopColor="#F1F5F9" />
              <stop offset="100%" stopColor="#CBD5E1" />
            </linearGradient>
            <linearGradient id="robotVisor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0F172A" />
              <stop offset="100%" stopColor="#1E293B" />
            </linearGradient>
            <linearGradient id="robotChest" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F8FAFC" />
              <stop offset="100%" stopColor="#E2E8F0" />
            </linearGradient>
          </defs>

          {/* Antenna — dental-blue tip pulse while listening */}
          <line x1="100" y1="18" x2="100" y2="34" stroke="#94A3B8" strokeWidth="4" strokeLinecap="round" />
          <circle cx="100" cy="14" r="7" fill={meta.eye} opacity={robot === 'listening' ? 1 : 0.75}>
            {(robot === 'listening' || robot === 'thinking') && (
              <animate attributeName="opacity" values={still ? undefined : '0.4;1;0.4'} dur="1.4s" repeatCount="indefinite" />
            )}
          </circle>

          {/* Head */}
          <rect x="42" y="34" width="116" height="96" rx="30" fill="url(#robotBody)" stroke="#94A3B8" strokeWidth="2" />
          {/* Visor */}
          <rect x="54" y="50" width="92" height="56" rx="22" fill="url(#robotVisor)" />

          {/* Eyes — expressive digital eyes */}
          <g>
            {(robot === 'listening') && (
              <>
                <circle cx="82" cy="78" r="9" fill={meta.eye}>
                  {!still && <animate attributeName="r" values="7;11;7" dur="1s" repeatCount="indefinite" />}
                </circle>
                <circle cx="118" cy="78" r="9" fill={meta.eye}>
                  {!still && <animate attributeName="r" values="7;11;7" dur="1s" repeatCount="indefinite" />}
                </circle>
              </>
            )}
            {(robot === 'thinking') && (
              <>
                <rect x="72" y="72" width="20" height="12" rx="6" fill={meta.eye}>
                  {!still && <animate attributeName="x" values="72;84;72" dur="1.6s" repeatCount="indefinite" />}
                </rect>
                <rect x="108" y="72" width="20" height="12" rx="6" fill={meta.eye}>
                  {!still && <animate attributeName="x" values="108;120;108" dur="1.6s" repeatCount="indefinite" />}
                </rect>
              </>
            )}
            {(robot === 'speaking' || robot === 'success') && (
              <>
                <path d="M74 78 q8 -12 16 0" stroke={meta.eye} strokeWidth="5" fill="none" strokeLinecap="round" />
                <path d="M110 78 q8 -12 16 0" stroke={meta.eye} strokeWidth="5" fill="none" strokeLinecap="round" />
              </>
            )}
            {(robot === 'idle') && (
              <>
                <circle cx="82" cy="78" r={blink ? 2.5 : 8} fill={meta.eye} />
                <circle cx="118" cy="78" r={blink ? 2.5 : 8} fill={meta.eye} />
              </>
            )}
            {(robot === 'interrupted' || robot === 'warning' || robot === 'waiting-approval') && (
              <>
                <circle cx="82" cy="78" r="8" fill={meta.eye} />
                <circle cx="118" cy="78" r="8" fill={meta.eye} />
                <circle cx="79" cy="75" r="2.5" fill="#0F172A" />
                <circle cx="115" cy="75" r="2.5" fill="#0F172A" />
              </>
            )}
            {(robot === 'error') && (
              <>
                <path d="M74 72 l16 12 M90 72 l-16 12" stroke={meta.eye} strokeWidth="5" strokeLinecap="round" />
                <path d="M110 72 l16 12 M126 72 l-16 12" stroke={meta.eye} strokeWidth="5" strokeLinecap="round" />
              </>
            )}
          </g>

          {/* Subtle mouth — speaker bars while speaking */}
          <g>
            {robot === 'speaking' ? (
              <>
                {[92, 100, 108].map((x, i) => (
                  <rect key={x} x={x - 2} y="92" width="4" height={i === 1 ? 10 : 7} rx="2" fill={meta.eye}>
                    {!still && <animate attributeName="height" values="4;10;4" dur="0.6s" begin={`${i * 0.15}s`} repeatCount="indefinite" />}
                  </rect>
                ))}
              </>
            ) : (
              <rect x="88" y="94" width="24" height="4" rx="2" fill="#334155" opacity="0.5" />
            )}
          </g>

          {/* Ears */}
          <rect x="30" y="66" width="10" height="30" rx="5" fill="#CBD5E1" stroke="#94A3B8" strokeWidth="1.5" />
          <rect x="160" y="66" width="10" height="30" rx="5" fill="#CBD5E1" stroke="#94A3B8" strokeWidth="1.5" />

          {/* Neck + body */}
          <rect x="88" y="128" width="24" height="10" fill="#CBD5E1" />
          <rect x="52" y="138" width="96" height="74" rx="24" fill="url(#robotChest)" stroke="#94A3B8" strokeWidth="2" />

          {/* Chest: subtle tooth motif (DenToRa branding — subtle, §23) */}
          <g transform="translate(84,150) scale(1.35)">
            <path
              d="M12 4 C7 4 4 8 4 13 C4 18 7 20 8 26 C9 31 11 31 12 26 C12.6 22 15.4 22 16 26 C17 31 19 31 20 26 C21 20 24 18 24 13 C24 8 21 4 16 4 C14.6 4 13.4 4.6 12 4.6 C10.6 4.6 13.4 4 12 4 Z"
              fill="none"
              stroke={meta.eye}
              strokeWidth="2.4"
              strokeLinejoin="round"
              opacity="0.9"
            />
          </g>
          {/* Chest status dot */}
          <circle cx="128" cy="196" r="5" fill={meta.eye}>
            {(robot === 'waiting-approval' || robot === 'warning' || robot === 'error') && (
              <animate attributeName="opacity" values={still ? undefined : '1;0.3;1'} dur="1s" repeatCount="indefinite" />
            )}
          </circle>

          {/* Arms hang calm; raise slightly when listening */}
          <rect
            x={robot === 'listening' ? 36 : 38}
            y="146"
            width="14"
            height="52"
            rx="7"
            fill="url(#robotBody)"
            stroke="#94A3B8"
            strokeWidth="2"
            style={{ transition: still ? undefined : 'x 0.3s ease' }}
          />
          <rect
            x={robot === 'listening' ? 150 : 148}
            y="146"
            width="14"
            height="52"
            rx="7"
            fill="url(#robotBody)"
            stroke="#94A3B8"
            strokeWidth="2"
            style={{ transition: still ? undefined : 'x 0.3s ease' }}
          />
        </svg>
      </div>

      {/* Accessible text state — always visible, never animation-only (§26) */}
      <div className="text-center max-w-full">
        <p className="text-sm font-semibold text-foreground" data-testid="robot-status-text">
          {statusLabel}
        </p>
        {detailText ? (
          <p className="text-xs text-muted-foreground line-clamp-2" data-testid="robot-detail-text">
            {detailText}
          </p>
        ) : null}
      </div>
    </div>
  )
}
