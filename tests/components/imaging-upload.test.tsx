// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'

import { LanguageProvider } from '@/components/providers/language-provider'
import { Toaster } from '@/components/ui/toaster'
import { ImagingUpload } from '@/components/imaging/ImagingUpload'

// Phase 20 (D3) — upload component contract:
//   - accepts JPEG/PNG/WebP up to 50MB (client pre-flight, server stays the gate)
//   - analyze defaults ON for PANORAMIC and locks off for other modalities
//     (19A D10.1: Liodon runs on PANORAMIC only)
//   - 201 + COMPLETED job  → done, onUploadComplete(studyId)
//   - 201 + PENDING job    → "Analyzing…" + status polling every 2s
//   - 422                  → server message surfaced, study still listed
//
// XMLHttpRequest is faked (fetch has no upload-progress events and jsdom's
// XHR is minimal): the fake records the form and lets tests fire the
// onload path deterministically.

class FakeXHR {
  static instances = []
  upload = { onprogress: null, onerror: null }
  status = 0
  responseText = ''
  onload = null
  open = vi.fn()
  sentForm = null
  send(form) {
    this.sentForm = form
    FakeXHR.instances.push(this)
  }
  complete(status, payload) {
    this.status = status
    this.responseText = JSON.stringify(payload)
    act(() => this.onload())
  }
}

function renderUpload(props = {}) {
  return render(
    <LanguageProvider initialLocale="en-US">
      <ImagingUpload patientId="pat-1" onUploadComplete={vi.fn()} {...props} />
      <Toaster />
    </LanguageProvider>
  )
}

function setFile(file) {
  const input = document.querySelector('input[type="file"]')
  fireEvent.change(input, { target: { files: [file] } })
}

beforeEach(() => {
  FakeXHR.instances = []
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ImagingUpload — file pre-flight', () => {
  it('rejects non-image files before uploading', () => {
    renderUpload()
    setFile(new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    expect(screen.queryByText('notes.txt')).toBeNull()
    expect(FakeXHR.instances).toHaveLength(0)
  })

  it('accepts a PNG and shows the chosen file', () => {
    renderUpload()
    setFile(new File(['x'], 'xray.png', { type: 'image/png' }))
    expect(screen.getByText(/xray.png/)).toBeTruthy()
    // Upload button unlocks.
    const uploadButton = screen.getAllByRole('button', { name: 'Upload X-ray' })[0]
    expect(uploadButton.disabled).toBe(false)
  })

  it('locks the AI switch for non-PANORAMIC modalities', () => {
    renderUpload()
    const switchInput = document.querySelector('input[type="checkbox"]')
    expect(switchInput.checked).toBe(true) // PANORAMIC default
    expect(switchInput.disabled).toBe(false)

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Periapical' }))
    expect(switchInput.checked).toBe(false)
    expect(switchInput.disabled).toBe(true)
  })
})

describe('ImagingUpload — upload outcomes', () => {
  it('201 with a COMPLETED job → done + onUploadComplete(studyId)', async () => {
    const onUploadComplete = vi.fn()
    renderUpload({ onUploadComplete })
    setFile(new File(['x'], 'xray.png', { type: 'image/png' }))

    fireEvent.click(screen.getAllByRole('button', { name: 'Upload X-ray' })[0])
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1))
    const xhr = FakeXHR.instances[0]
    expect(xhr.open.mock.calls[0][1]).toBe('/api/imaging/studies')

    xhr.complete(201, { study: { id: 'study-9' }, job: { id: 'job-9', status: 'COMPLETED' } })
    await waitFor(() => expect(onUploadComplete).toHaveBeenCalledWith('study-9'))
    expect(screen.getByText('Analysis completed')).toBeTruthy()
  })

  it('201 with a PENDING job → analyzing state + polls the status endpoint', async () => {
    const onUploadComplete = vi.fn()
    renderUpload({ onUploadComplete })
    setFile(new File(['x'], 'xray.png', { type: 'image/png' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload X-ray' })[0])
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1))
    FakeXHR.instances[0].complete(201, { study: { id: 'study-9' }, job: { id: 'job-9', status: 'PENDING' } })

    expect(screen.getByText('Analyzing...')).toBeTruthy()

    // Fake the 2s poll (fetch, not XHR).
    const statusFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ANALYZED', latestJob: { status: 'COMPLETED' } }),
    })
    vi.stubGlobal('fetch', statusFetch)
    // The poll is a real 2s interval — wait just past its first tick.
    await new Promise((r) => setTimeout(r, 2300))
    await waitFor(() => expect(statusFetch).toHaveBeenCalled())
    expect(statusFetch.mock.calls[0][0]).toBe('/api/imaging/studies/study-9/status')
    await waitFor(() => expect(onUploadComplete).toHaveBeenCalledWith('study-9'))
  })

  it('422 (non-PANORAMIC analyze) surfaces the server key and still lists the study', async () => {
    const onUploadComplete = vi.fn()
    renderUpload({ onUploadComplete })
    setFile(new File(['x'], 'xray.png', { type: 'image/png' }))
    // Uploads a PANORAMIC with analyze=true; the server-side 422 backstop
    // (19A) still governs non-PANORAMIC uploads regardless of the client.
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload X-ray' })[0])
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1))
    FakeXHR.instances[0].complete(422, {
      study: { id: 'study-10' },
      error: 'AI analysis is only supported for PANORAMIC studies',
    })
    await waitFor(() => expect(onUploadComplete).toHaveBeenCalledWith('study-10'))
    // The dictionary key is translated, not shown raw.
    expect(screen.getByText('AI analysis is only supported for PANORAMIC studies')).toBeTruthy()
  })

  it('upload progress is reported via XHR upload events', async () => {
    renderUpload()
    setFile(new File(['x'], 'xray.png', { type: 'image/png' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload X-ray' })[0])
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1))
    const xhr = FakeXHR.instances[0]
    act(() => xhr.upload.onprogress({ lengthComputable: true, loaded: 25, total: 100 }))
    // The repo's Progress consumes `value` for the indicator transform only
    // (no aria-valuenow), so assert the indicator position: 25% => -75%.
    const indicator = screen.getByRole('progressbar').firstElementChild
    expect(indicator.style.transform).toBe('translateX(-75%)')
  })

  it('network error → retryable error state with the retry button', async () => {
    renderUpload()
    setFile(new File(['x'], 'xray.png', { type: 'image/png' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload X-ray' })[0])
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1))
    act(() => FakeXHR.instances[0].onerror())
    expect(screen.getByText('Network error')).toBeTruthy()
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry).toBeTruthy()
  })
})
