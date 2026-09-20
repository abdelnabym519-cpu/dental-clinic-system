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
}

export interface MessagingProvider {
  /** Provider identifier persisted on MessageQueue.provider. */
  readonly name: string
  readonly channel: MessageChannel
  sendMessage(to: string, message: MessagePayload): Promise<SendResult>
}
