// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockSendEmail } = vi.hoisted(() => ({
  mockSendEmail: vi.fn(),
}))

vi.mock('@/lib/services/email.service', () => ({
  emailService: {
    sendEmail: mockSendEmail,
  },
}))

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { sendInviteEmail, sendVerificationEmail } from '@/lib/email-helpers'

// ═════════════════════════════════════════════════════════════════════════════
// sendInviteEmail
// ═════════════════════════════════════════════════════════════════════════════

describe('sendInviteEmail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends invite email with correct subject and content', async () => {
    mockSendEmail.mockResolvedValue(undefined)

    const result = await sendInviteEmail({
      to: 'john@example.com',
      inviteeName: 'John',
      hospitalName: 'Smile Dental',
      role: 'DOCTOR',
      inviterName: 'Admin User',
      token: 'abc123',
    })

    expect(result).toBe(true)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const call = mockSendEmail.mock.calls[0][0]
    expect(call.to).toBe('john@example.com')
    expect(call.subject).toContain('Smile Dental')
    // Issue 6 contract: Arabic invite subject + RTL body
    expect(call.subject).toContain('دعوة')
    expect(call.body).toContain('قبول الدعوة')
    expect(call.body).toContain('dir="rtl"')
    expect(call.body).toContain('John')
    expect(call.body).toContain('Smile Dental')
    expect(call.body).toContain('Admin User')
    expect(call.body).toContain('طبيب') // Issue 6: canonical Arabic role
    expect(call.body).toContain('abc123') // token in link
  })

  it('returns false on email send failure', async () => {
    mockSendEmail.mockRejectedValue(new Error('SMTP error'))

    const result = await sendInviteEmail({
      to: 'john@example.com',
      inviteeName: 'John',
      hospitalName: 'Smile Dental',
      role: 'ADMIN',
      inviterName: 'Admin User',
      token: 'abc123',
    })

    expect(result).toBe(false)
  })

  it('includes invite link with token', async () => {
    mockSendEmail.mockResolvedValue(undefined)

    await sendInviteEmail({
      to: 'jane@example.com',
      inviteeName: 'Jane',
      hospitalName: 'Clinic',
      role: 'STAFF',
      inviterName: 'Admin',
      token: 'xyz789',
    })

    const html = mockSendEmail.mock.calls[0][0].body
    expect(html).toContain('/invite/accept?token=xyz789')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// sendVerificationEmail
// ═════════════════════════════════════════════════════════════════════════════

describe('sendVerificationEmail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends verification email with correct subject and content', async () => {
    mockSendEmail.mockResolvedValue(undefined)

    const result = await sendVerificationEmail({
      to: 'admin@example.com',
      userName: 'Admin',
      hospitalName: 'New Clinic',
      token: 'verify123',
    })

    expect(result).toBe(true)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const call = mockSendEmail.mock.calls[0][0]
    expect(call.to).toBe('admin@example.com')
    // Issue 6 contract: Arabic-only system emails.
    expect(call.subject).toContain('تأكيد')
    expect(call.body).toContain('Admin')
    expect(call.body).toContain('New Clinic')
    expect(call.body).toContain('/verify-email?token=verify123')
  })

  it('returns false on email send failure', async () => {
    mockSendEmail.mockRejectedValue(new Error('Connection timeout'))

    const result = await sendVerificationEmail({
      to: 'admin@example.com',
      userName: 'Admin',
      hospitalName: 'New Clinic',
      token: 'verify123',
    })

    expect(result).toBe(false)
  })

  it('generates proper HTML wrapper', async () => {
    mockSendEmail.mockResolvedValue(undefined)

    await sendVerificationEmail({
      to: 'test@test.com',
      userName: 'Test',
      hospitalName: 'Test Clinic',
      token: 'token1',
    })

    const html = mockSendEmail.mock.calls[0][0].body
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Dentora')
    expect(html).toContain('تأكيد بريدك الإلكتروني')
    expect(html).toContain('24 ساعة') // expiry note
    // Issue 6: the whole system email is Arabic RTL — no English prose remains
    expect(html).not.toContain('Verify your email address')
    expect(html).not.toContain('This link expires')
  })
})
