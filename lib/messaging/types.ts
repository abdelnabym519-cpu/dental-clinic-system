/**
 * Messaging platform contracts (master prompt 3A). Every provider — WhatsApp
 * or SMS, Meta or Baileys or Twilio or Africa's Talking or the test mock —
 * implements the same tiny interface, so the queue processor and the fallback
 * strategy never care which one is configured.
 */

export type MessageChannel = 'WHATSAPP' | 'SMS'

export interface MessageAttachment {
  filename: string
  mimeType: string
  /** Base64-encoded bytes (documents/images). */
  data: string
}

export interface MessagePayload {
  text: string
  attachment?: MessageAttachment
}

export interface SendResult {
  success: boolean
  /** Provider-specific message id when available. */
  providerMessageId?: string
  error?: string
  /** Provider error code (e.g. the Meta Graph API code) when the provider exposes one. */
  errorCode?: number
  /**
   * Whether the queue may retry this failure. false for terminal errors
   * (Meta 190 token expired, 131047 undeliverable, 131026 not on WhatsApp);
   * true for rate limits, server errors and unknown failures (fail safe).
   */
  retryable?: boolean
}

export interface MessagingProvider {
  /** Provider identifier persisted on MessageQueue.provider. */
  readonly name: string
  readonly channel: MessageChannel
  sendMessage(to: string, message: MessagePayload): Promise<SendResult>
}
