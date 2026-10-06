// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

import { LanguageProvider } from '@/components/providers/language-provider'
import { Toaster } from '@/components/ui/toaster'
import { DoctorReviewPanel } from '@/components/imaging/DoctorReviewPanel'

// Phase 20 (D6) — the review panel must call the EXISTING 19A contract
// (POST /api/imaging/jobs/:id/review) with the right decision semantics:
//
//   accept all        → ACCEPTED (server keeps the AI findings)
//   accept all (all ticked)   → ACCEPTED
//   accept a subset  → MODIFIED + acceptedFindings = exactly the subset
//   reject all       → REJECTED (behind the confirmation dialog)

const FINDINGS = [
  {
    condition: 'caries',
    tooth_number: null,
    confidence: 0.94,
    bounding_box: { x: 100, y: 50, width: 200, height: 120, x2: 300, y2: 170 },
  },
  {
    condition: 'periapical_lesion',
    tooth_number: null,
    confidence: 0.87,
    bounding_box: { x: 400, y: 300, width: 150, height: 90, x2: 550, y2: 390 },
  },
  {
    condition: 'impacted_tooth',
    tooth_number: null,
    confidence: 0.71,
    bounding_box: { x: 700, y: 100, width: 80, height: 60, x2: 780, y2: 160 },
  },
]

let fetchMock

function renderPanel(onReviewComplete = vi.fn()) {
  render(
    <LanguageProvider initialLocale="en-US">
      <DoctorReviewPanel jobId="job-1" findings={FINDINGS} onReviewComplete={onReviewComplete} />
      <Toaster />
    </LanguageProvider>
  )
}

function lastRequestBody() {
  return JSON.parse(fetchMock.mock.calls.at(-1)[1].body)
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ job: { id: 'job-1', reviewDecision: 'ACCEPTED' } }),
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DoctorReviewPanel — decision semantics', () => {
  it('accept-all posts ACCEPTED without acceptedFindings', async () => {
    const onReviewComplete = vi.fn()
    renderPanel(onReviewComplete)
    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/imaging/jobs/job-1/review')
    const body = lastRequestBody()
    expect(body.decision).toBe('ACCEPTED')
    expect(body.acceptedFindings).toBeUndefined()
    expect(onReviewComplete).toHaveBeenCalledWith('ACCEPTED')
  })

  it('accept-selected with every finding ticked still posts ACCEPTED', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Accept selected' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(lastRequestBody().decision).toBe('ACCEPTED')
  })

  it('accept-selected with a subset posts MODIFIED + exactly that subset', async () => {
    renderPanel()
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1]) // untick the periapical finding

    fireEvent.click(screen.getByRole('button', { name: 'Accept selected (2)' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = lastRequestBody()
    expect(body.decision).toBe('MODIFIED')
    expect(body.acceptedFindings).toHaveLength(2)
    expect(body.acceptedFindings.map((f) => f.condition)).toEqual(['caries', 'impacted_tooth'])
    // Wire contract intact: boxes travel unmodified.
    expect(body.acceptedFindings[0].bounding_box.x).toBe(100)
  })

  it('reject-all asks for confirmation, then posts REJECTED', async () => {
    const onReviewComplete = vi.fn()
    renderPanel(onReviewComplete)
    fireEvent.click(screen.getByRole('button', { name: 'Reject all' }))

    // The confirmation dialog appears (portal); confirm it.
    const confirmButtons = await screen.findAllByRole('button', { name: 'Reject all' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(lastRequestBody().decision).toBe('REJECTED')
    expect(onReviewComplete).toHaveBeenCalledWith('REJECTED')
  })

  it('cancelling the confirmation posts nothing', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Reject all' }))
    await waitFor(() => expect(screen.getByText('Reject all AI findings?')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the doctor notes when provided', async () => {
    renderPanel()
    fireEvent.change(screen.getByPlaceholderText('Add clinical notes (optional)'), {
      target: { value: 'Consistent with clinical exam.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(lastRequestBody().reviewNotes).toBe('Consistent with clinical exam.')
  })

  it('toasts the server error on a 409 (job not reviewable) and posts no review', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Only completed jobs can be reviewed' }),
    })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }))
    await waitFor(() => expect(screen.getByText('Only completed jobs can be reviewed')).toBeTruthy())
  })
})
