// @ts-nocheck
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LanguageProvider } from '@/components/providers/language-provider'

/**
 * Phase 13 bug fix — portal login (online-booking entry point) phone field.
 *
 * Egyptian mobile numbers are 11 digits (01XXXXXXXXX). The login form used
 * to cap the input at 10 digits (maxLength / slice / length check), which
 * made it impossible to type a full Egyptian number and therefore to log in
 * and book online. These tests pin the 11-digit behavior end to end on the
 * form: an 11-digit number is fully accepted, longer input is truncated at
 * 11, and a 10-digit value is rejected with the 11-digit validation message.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

async function renderLogin(locale = 'en-US') {
  const { default: PatientLoginPage } = await import('@/app/portal/login/page')
  return render(
    <LanguageProvider initialLocale={locale}>
      <PatientLoginPage />
    </LanguageProvider>
  )
}

describe('Portal login phone field — 11-digit Egyptian mobile numbers', () => {
  it('keeps all 11 digits of an Egyptian mobile number', async () => {
    await renderLogin()
    const phone = screen.getByPlaceholderText('Enter your 11-digit number')

    fireEvent.change(phone, { target: { value: '01012345678' } })

    expect(phone.value).toBe('01012345678')
    expect(phone.getAttribute('maxlength')).toBe('11')
  })

  it('truncates input at 11 digits', async () => {
    await renderLogin()
    const phone = screen.getByPlaceholderText('Enter your 11-digit number')

    fireEvent.change(phone, { target: { value: '01012345678901' } })

    expect(phone.value).toBe('01012345678')
  })

  it('strips non-digits while typing', async () => {
    await renderLogin()
    const phone = screen.getByPlaceholderText('Enter your 11-digit number')

    fireEvent.change(phone, { target: { value: '010-123-45678' } })

    expect(phone.value).toBe('01012345678')
  })

  it('rejects a 10-digit number with the 11-digit validation message', async () => {
    await renderLogin()
    const phone = screen.getByPlaceholderText('Enter your 11-digit number')
    fireEvent.change(phone, { target: { value: '0101234567' } })

    fireEvent.click(screen.getByText('Send OTP'))

    expect(screen.getByText('Please enter a valid 11-digit phone number')).toBeTruthy()
  })
})
