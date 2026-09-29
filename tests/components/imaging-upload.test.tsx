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

  it('keeps the AI switch available for 19B-analyzable modalities (Periapical → Implant AI)', () => {
    renderUpload()
    const switchInput = document.querySelector('input[type="checkbox"]')
    expect(switchInput.checked).toBe(true) // PANORAMIC default
    expect(switchInput.disabled).toBe(false)

    // 19B D14: PERIAPICAL routes to implant-ai, so analyze stays enabled.
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Periapical' }))
    expect(switchInput.disabled).toBe(false)
  })

  it('locks the AI switch for the only engine-less modality (PHOTO)', () => {
    renderUpload()
    const switchInput = document.querySelector('input[type="checkbox"]')
    expect(switchInput.checked).toBe(true) // PANORAMIC default

    // Phase 20B: CBCT/THREE_D_SCAN now analyze (MeshSegNet); PHOTO is the
    // only modality without an engine.
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Clinical photo' }))
    expect(switchInput.checked).toBe(false)
    expect(switchInput.disabled).toBe(true)
  })

  it('keeps the AI switch enabled for CEPHALOMETRIC (19B: orthodontic-ai)', () => {
    renderUpload()
    const switchInput = document.querySelector('input[type="checkbox"]')

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Cephalometric' }))
    expect(switchInput.disabled).toBe(false)
    expect(switchInput.checked).toBe(true)
  })
})

describe('ImagingUpload — Phase 20B: 3D mesh upload + jaw selector', () => {
  it('shows the jaw selector only for 3D modalities (default: maxilla)', () => {
    renderUpload()
    // Hidden for PANORAMIC.
    expect(screen.queryByText('Jaw')).toBeNull()

    // Visible for CBCT with both options, maxilla preselected.
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'CBCT' }))
    expect(screen.getByText('Jaw')).toBeTruthy()
    const comboboxes = screen.getAllByRole('combobox')
    fireEvent.click(comboboxes[1]) // the jaw selector
    expect(screen.getByRole('option', { name: 'Maxilla (upper)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Mandible (lower)' })).toBeTruthy()
    expect(screen.getByText(/analyzes one jaw at a time/)).toBeTruthy()
  })

  it('accepts a .obj mesh for CBCT and sends jaw=max by default', async () => {
    renderUpload()
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'CBCT' }))

    setFile(new File(['mesh'], 'jaw.obj', { type: 'application/octet-stream' }))
    expect(screen.getByText(/jaw\.obj/)).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Upload X-ray' })[0])
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1))
    const form = FakeXHR.instances[0].sentForm
    expect(form.get('modality')).toBe('CBCT')
    expect(form.get('jaw')).toBe('max')
    expect(form.get('analyze')).toBe('true')
  })

  it('sends jaw=man when the doctor picks the mandible', async () => {
    renderUpload()
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'CBCT' }))

    const comboboxes = screen.getAllByRole('combobox')
    fireEvent.click(comboboxes[1])
    fireEvent.click(screen.getByRole('option', { name: 'Mandible (lower)' }))

    setFile(new File(['mesh'], 'mandible.stl', { type: 'application/octet-stream' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload X-ray' })[0])
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1))
    expect(FakeXHR.instances[0].sentForm.get('jaw')).toBe('man')
  })

  it('refuses a .npy file for 3D modalities (engines take triangular meshes)', () => {
    renderUpload()
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'CBCT' }))

    setFile(new File(['x'], 'cloud.npy', { type: 'application/octet-stream' }))
    expect(screen.queryByText(/cloud\.npy/)).toBeNull()
    expect(screen.getByText('Unsupported 3D format. Use .obj, .stl, .vtk or .ply')).toBeTruthy()
    expect(FakeXHR.instances).toHaveLength(0)
  })

  it('refuses an image file for a 3D modality (mesh gate)', () => {
    renderUpload()
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'CBCT' }))
    setFile(new File(['x'], 'xray.png', { type: 'image/png' }))
    expect(screen.queryByText(/xray\.png/)).toBeNull()
    expect(screen.getByText('Unsupported 3D format. Use .obj, .stl, .vtk or .ply')).toBeTruthy()
    expect(FakeXHR.instances).toHaveLength(0)
  })

  it('refuses a mesh file for an image modality (image gate)', () => {
    renderUpload() // default modality: PANORAMIC
    setFile(new File(['mesh'], 'jaw.obj', { type: 'application/octet-stream' }))
    expect(screen.queryByText(/jaw\.obj/)).toBeNull()
    expect(FakeXHR.instances).toHaveLength(0)
  })

  it('drops a selected file when switching between the image and mesh families', () => {
    renderUpload()
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'CBCT' }))
    setFile(new File(['mesh'], 'jaw.obj', { type: 'application/octet-stream' }))
    expect(screen.getByText(/jaw\.obj/)).toBeTruthy()

    const comboboxes = screen.getAllByRole('combobox')
    fireEvent.click(comboboxes[0])
    fireEvent.click(screen.getByRole('option', { name: 'Panoramic' }))
    expect(screen.queryByText(/jaw\.obj/)).toBeNull()
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

  it('422 (no engine for the modality) surfaces the translated message and still lists the study', async () => {
    const onUploadComplete = vi.fn()
    renderUpload({ onUploadComplete })
    setFile(new File(['x'], 'xray.png', { type: 'image/png' }))
    // Uploads a PANORAMIC with analyze=true; the server-side 422 backstop
    // still governs modalities without an image engine regardless of the
    // client (19B D14: the message is a dictionary key + modality data).
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload X-ray' })[0])
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1))
    FakeXHR.instances[0].complete(422, {
      study: { id: 'study-10' },
      error: 'AI analysis is not supported for this modality',
      modality: 'CBCT',
    })
    await waitFor(() => expect(onUploadComplete).toHaveBeenCalledWith('study-10'))
    // The dictionary key is translated, not shown raw.
    expect(screen.getByText('AI analysis is not supported for this modality')).toBeTruthy()
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
