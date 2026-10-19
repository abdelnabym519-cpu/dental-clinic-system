// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { beforeAll } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AIProvider, useAI } from '@/components/ai/ai-provider'
import { ChatWidget } from '@/components/ai/chat-widget'
import ChatPage from '@/app/(dashboard)/chat/page'

// jsdom has no Web Speech APIs — use-web-voice must degrade gracefully.
vi.mock('next/navigation', () => ({ usePathname: () => '/patients/p1/dental-chart' }))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function Providers({ children }: { children: React.ReactNode }) {
  return <AIProvider>{children}</AIProvider>
}

const streamedResponse = (text: string) =>
  new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(text))
        c.close()
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  )

describe('WS-A RESTORATION: the previous AI assistant is the primary surface again', () => {
  // jsdom does not implement scrollIntoView (the widget auto-scrolls on new messages)
  beforeAll(() => {
    Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {})
  })
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
  })

  it('the floating assistant mounts, opens, and its composer posts to /api/ai/chat with page context', async () => {
    fetchMock.mockImplementation(async () => streamedResponse('مرحباً بك'))
    render(
      <Providers>
        <ChatWidget />
      </Providers>
    )
    // the floating launcher is present by default (closed widget)
    const launcher = screen.getByRole('button', { name: /open ai chat/i })
    fireEvent.click(launcher)
    // composer is available after opening
    const box = await waitFor(() => screen.getByRole('textbox'))
    fireEvent.change(box, { target: { value: 'ما حالة المريض؟' } })
    // the previous assistant submits on Enter (no form wrapper)
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: false })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/ai/chat')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(Array.isArray(body.messages)).toBe(true)
    // patient-context awareness: the ACTIVE page path travels with the turn
    expect(body.page).toBe('/patients/p1/dental-chart')
  })

  it('the restored /chat route renders the full assistant surface (not a redirect stub)', async () => {
    render(
      <Providers>
        <ChatPage />
      </Providers>
    )
    // the page mounts the voice orb + composer (previous assistant experience)
    await waitFor(() => expect(screen.getByRole('textbox')).toBeTruthy())
  })

  it('REGRESSION: the robot companion remains available but is NOT the primary assistant', () => {
    // shell mounts the restored floating assistant
    const shell = readFileSync('components/layout/dashboard-shell.tsx', 'utf8')
    expect(shell).toContain('<ChatWidget />')
    // /chat is a real assistant page (client surface), not a redirect to the robot
    const page = readFileSync('app/(dashboard)/chat/page.tsx', 'utf8')
    expect(page).toContain("'use client'")
    expect(page).not.toContain("redirect('/ai-companion')")
  })
})
