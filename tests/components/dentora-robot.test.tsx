// @ts-nocheck
/**
 * Phase 10 — DenToRa Robot component tests (§23–§26).
 *
 * The robot is presentation-only: every visual state must come from the
 * canonical InteractionState, and accessibility is part of the contract.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

import { DentoraRobot, robotStateFor } from '@/components/robot/dentora-robot'
import type { InteractionState } from '@/lib/ai/voice/types'

describe('robotStateFor — one canonical mapping (§34)', () => {
  it('maps every interaction state to exactly one robot state', () => {
    expect(robotStateFor('IDLE')).toBe('idle')
    expect(robotStateFor('LISTENING')).toBe('listening')
    expect(robotStateFor('TRANSCRIBING')).toBe('thinking')
    expect(robotStateFor('UNDERSTANDING')).toBe('thinking')
    expect(robotStateFor('PROCESSING')).toBe('thinking')
    expect(robotStateFor('WAITING_APPROVAL')).toBe('waiting-approval')
    expect(robotStateFor('SPEAKING')).toBe('speaking')
    expect(robotStateFor('INTERRUPTED')).toBe('interrupted')
    expect(robotStateFor('WARNING')).toBe('warning')
    expect(robotStateFor('ERROR')).toBe('error')
    expect(robotStateFor('COMPLETED')).toBe('success')
    expect(robotStateFor('CANCELLED')).toBe('idle')
  })

  it('never produces a state outside the 9 allowed robot states', () => {
    const allowed = new Set(['idle', 'listening', 'thinking', 'speaking', 'interrupted', 'waiting-approval', 'warning', 'error', 'success'])
    const all: InteractionState[] = ['IDLE', 'LISTENING', 'TRANSCRIBING', 'UNDERSTANDING', 'PROCESSING', 'WAITING_APPROVAL', 'SPEAKING', 'INTERRUPTED', 'WARNING', 'ERROR', 'COMPLETED', 'CANCELLED']
    for (const s of all) expect(allowed.has(robotStateFor(s))).toBe(true)
  })
})

describe('DentoraRobot rendering + accessibility (§26)', () => {
  it('renders with a status role and live region', () => {
    render(<DentoraRobot state="IDLE" statusLabel="جاهز" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByLabelText('جاهز')).toBeInTheDocument()
  })

  it('reflects the real interaction state in data-robot-state (no fake thinking)', () => {
    const { container } = render(<DentoraRobot state="PROCESSING" statusLabel="thinking" />)
    expect(container.firstElementChild.getAttribute('data-robot-state')).toBe('thinking')
  })

  it('waiting-approval is visually distinct from success and error', () => {
    const { container: a } = render(<DentoraRobot state="WAITING_APPROVAL" statusLabel="approval" />)
    const { container: b } = render(<DentoraRobot state="COMPLETED" statusLabel="done" />)
    const { container: c } = render(<DentoraRobot state="ERROR" statusLabel="err" />)
    const states = [
      a.firstElementChild.getAttribute('data-robot-state'),
      b.firstElementChild.getAttribute('data-robot-state'),
      c.firstElementChild.getAttribute('data-robot-state'),
    ]
    expect(new Set(states).size).toBe(3)
  })

  it('decorative art is aria-hidden — screen readers get text only', () => {
    const { container } = render(<DentoraRobot state="SPEAKING" statusLabel="speaking" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })

  it('reducedMotion suppresses eye animation (vestibular safety, §26)', () => {
    const { container } = render(<DentoraRobot state="LISTENING" statusLabel="listening" reducedMotion />)
    // Listening pulses the eyes via <animate> — none may exist when reduced.
    const pulses = Array.from(container.querySelectorAll('animate')).filter((a) => a.getAttribute('values'))
    expect(pulses.length).toBe(0)
  })

  it('supports all responsive sizes including kiosk (§25)', () => {
    for (const [size, px] of [['sm', 96], ['md', 160], ['lg', 240], ['kiosk', 320]]) {
      const { container, unmount } = render(<DentoraRobot state="IDLE" statusLabel="s" size={size} />)
      const box = container.querySelector('[role="status"]')
      expect(box.style.width).toBe(`${px}px`)
      unmount()
    }
  })

  it('shows the accessible detail text when provided', () => {
    render(<DentoraRobot state="WAITING_APPROVAL" statusLabel="waiting" detailText="تأكيد الحجز؟" />)
    expect(screen.getByText('تأكيد الحجز؟')).toBeInTheDocument()
  })
})
