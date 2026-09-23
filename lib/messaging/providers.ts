import type { MessagingProvider, MessagePayload, SendResult } from './types'
import { toProviderDigits } from '../phone'

/**
 * Provider implementations (master prompt 3A). All network providers use
 * fetch with no SDK dependencies; credentials come from env only and are
 * never logged or returned. Each provider fails soft — the queue's fallback
 * and retry logic own error handling.
 */

const META_API_VERSION = process.env.META_API_VERSION || 'v18.0'

/**
 * Phase 10 — Meta Graph API error codes that must NOT be retried (terminal).
 * 190 = token expired (alert the admin, rotating the token is the fix),
 * 131047 = message undeliverable, 131026 = recipient not on WhatsApp.
 * Everything else (130429 rate limit, 5xx, unknown) is retryable — fail safe.
 */
const META_NO_RETRY_CODES = new Set([190, 131047, 131026])

export function metaErrorRetryable(code: number | undefined): boolean {
  return code === undefined || !META_NO_RETRY_CODES.has(code)
}

/** Meta WhatsApp Business Cloud API (text + template + document/image by media upload). */
export class MetaWhatsAppProvider implements MessagingProvider {
  readonly name = 'meta-whatsapp'
  readonly channel = 'WHATSAPP' as const

  private token = process.env.META_WHATSAPP_TOKEN || ''
  private phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID || ''
  private apiBase = process.env.META_API_BASE || `https://graph.facebook.com/${META_API_VERSION}`

  private configured(): boolean {
    return Boolean(this.token && this.phoneNumberId)
  }

  private async uploadMedia(
    attachment: NonNullable<MessagePayload['attachment']>
  ): Promise<string | null> {
    try {
      const form = new FormData()
      form.append(
        'file',
        new Blob([Buffer.from(attachment.data, 'base64')], { type: attachment.mimeType }),
        attachment.filename
      )
      form.append('messaging_product', 'whatsapp')
      const res = await fetch(`${this.apiBase}/${this.phoneNumberId}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
        body: form,
      })
      if (!res.ok) return null
      const data = (await res.json()) as { id?: string }
      return data.id ?? null
    } catch {
      return null
    }
  }

  /** Phase 10 — normalized target: Meta takes international digits without "+". */
  private target(to: string): string {
    return toProviderDigits(to) ?? to
  }

  /**
   * Phase 10 — shared POST to /messages with Meta error parsing:
   * the Graph API error body carries a numeric `code` which drives the
   * queue's retry decision via SendResult.retryable (metaErrorRetryable).
   */
  private async postMessage(body: Record<string, unknown>): Promise<SendResult> {
    if (!this.configured()) {
      return { success: false, error: 'Meta WhatsApp not configured (token / phone number id)' }
    }
    try {
      const res = await fetch(`${this.apiBase}/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>
        error?: { message?: string; code?: number }
      }
      if (!res.ok) {
        const code = typeof data?.error?.code === 'number' ? data.error.code : undefined
        return {
          success: false,
          error: data?.error?.message || `Meta API ${res.status}`,
          errorCode: code,
          retryable: metaErrorRetryable(code),
        }
      }
      return { success: true, providerMessageId: data?.messages?.[0]?.id }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Meta send failed' }
    }
  }

  async sendMessage(to: string, message: MessagePayload): Promise<SendResult> {
    let body: Record<string, unknown>
    if (message.attachment) {
      const mediaId = await this.uploadMedia(message.attachment)
      if (!mediaId) return { success: false, error: 'Media upload failed' }
      const kind = message.attachment.mimeType.startsWith('image/') ? 'image' : 'document'
      body = {
        messaging_product: 'whatsapp',
        to: this.target(to),
        type: kind,
        [kind]:
          kind === 'image'
            ? { id: mediaId, caption: message.text }
            : { id: mediaId, caption: message.text, filename: message.attachment.filename },
      }
    } else {
      body = {
        messaging_product: 'whatsapp',
        to: this.target(to),
        type: 'text',
        text: { body: message.text },
      }
    }
    return this.postMessage(body)
  }

  /**
   * Phase 10 — template message. Required for proactive outreach outside the
   * 24h customer-service window (appointment confirmation/reminder). The
   * template must be pre-approved in Meta Business Manager; parameters map
   * positionally onto the body's {{1}}, {{2}}, … placeholders.
   */
  async sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string,
    parameters: string[]
  ): Promise<SendResult> {
    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to: this.target(to),
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          {
            type: 'body',
            parameters: parameters.map((text) => ({ type: 'text', text })),
          },
        ],
      },
    }
    return this.postMessage(body)
  }
}

/** Twilio Programmable SMS (text-only; attachments are not supported on SMS). */
export class TwilioSMSProvider implements MessagingProvider {
  readonly name = 'twilio-sms'
  readonly channel = 'SMS' as const

  private sid = process.env.TWILIO_ACCOUNT_SID || ''
  private token = process.env.TWILIO_AUTH_TOKEN || ''
  private from = process.env.TWILIO_FROM_NUMBER || ''

  async sendMessage(to: string, message: MessagePayload): Promise<SendResult> {
    if (!this.sid || !this.token || !this.from) {
      return { success: false, error: 'Twilio not configured (SID / token / from number)' }
    }
    try {
      const body = new URLSearchParams({
        To: to,
        From: this.from,
        Body: message.text,
      })
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.sid}:${this.token}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        }
      )
      const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string }
      if (!res.ok) {
        return { success: false, error: data?.message || `Twilio API ${res.status}` }
      }
      return { success: true, providerMessageId: data?.sid }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Twilio send failed' }
    }
  }
}

/** Africa's Talking SMS (text-only). */
export class AfricasTalkingSMSProvider implements MessagingProvider {
  readonly name = 'africas-talking-sms'
  readonly channel = 'SMS' as const

  private apiKey = process.env.AFRICAS_TALKING_API_KEY || ''
  private username = process.env.AFRICAS_TALKING_USERNAME || ''
  private from = process.env.AFRICAS_TALKING_FROM || ''

  async sendMessage(to: string, message: MessagePayload): Promise<SendResult> {
    if (!this.apiKey || !this.username) {
      return { success: false, error: "Africa's Talking not configured (api key / username)" }
    }
    try {
      const body = new URLSearchParams({
        username: this.username,
        to,
        message: message.text,
        ...(this.from ? { from: this.from } : {}),
      })
      const res = await fetch('https://api.africastalking.com/version1/messaging', {
        method: 'POST',
        headers: {
          apiKey: this.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body,
      })
      const data = (await res.json().catch(() => ({}))) as {
        SMSMessageData?: { Recipients?: Array<{ messageId?: string; status?: string }> }
      }
      if (!res.ok) {
        return { success: false, error: `Africa's Talking API ${res.status}` }
      }
      const recipient = data?.SMSMessageData?.Recipients?.[0]
      if (recipient?.status && !['Queued', 'Sent', 'Success'].includes(recipient.status)) {
        return { success: false, error: `Africa's Talking status: ${recipient.status}` }
      }
      return { success: true, providerMessageId: recipient?.messageId }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Africa's Talking send failed",
      }
    }
  }
}

/**
 * In-process mock provider — active when messaging is disabled or no real
 * provider is configured (dev/test). Marks sends as successful so the queue
 * pipeline, fallback strategy and audit log can be exercised end-to-end
 * without credentials and without any external call (master prompt §7 note).
 */
export class MockMessagingProvider implements MessagingProvider {
  readonly name: string
  readonly channel: 'WHATSAPP' | 'SMS'
  public sent: Array<{ to: string; text: string; hasAttachment: boolean }> = []

  constructor(channel: 'WHATSAPP' | 'SMS', name?: string) {
    this.channel = channel
    this.name = name ?? `mock-${channel.toLowerCase()}`
  }

  async sendMessage(to: string, message: MessagePayload): Promise<SendResult> {
    this.sent.push({ to, text: message.text, hasAttachment: Boolean(message.attachment) })
    return { success: true, providerMessageId: `mock-${Date.now()}` }
  }
}
