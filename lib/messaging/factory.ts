import type { MessagingProvider, MessagePayload, SendResult } from './types'
import {
  MetaWhatsAppProvider,
  TwilioSMSProvider,
  AfricasTalkingSMSProvider,
  MockMessagingProvider,
} from './providers'
import { getBaileysProvider } from './baileys-provider'

/**
 * Provider selection (master prompt 3A/3M):
 *   WHATSAPP_PROVIDER=meta|baileys|mock   (default: mock when unconfigured)
 *   SMS_PROVIDER=twilio|africas_talking|mock
 * When MESSAGING_ENABLED !== 'true' (or no provider env is set) the mock
 * provider is used: sends "succeed" locally with zero external calls, which
 * keeps the whole pipeline verifiable without credentials.
 */

export function getWhatsAppProvider(): MessagingProvider {
  if (process.env.MESSAGING_ENABLED !== 'true') return new MockMessagingProvider('WHATSAPP')
  switch (process.env.WHATSAPP_PROVIDER) {
    case 'meta':
      return new MetaWhatsAppProvider()
    case 'baileys':
      // Process-wide singleton: the super-admin QR page and the queue must
      // share one Baileys session (spec D4).
      return getBaileysProvider()
    case 'mock':
      return new MockMessagingProvider('WHATSAPP')
    default:
      return new MockMessagingProvider('WHATSAPP')
  }
}

export function getSMSProvider(): MessagingProvider {
  if (process.env.MESSAGING_ENABLED !== 'true') return new MockMessagingProvider('SMS')
  switch (process.env.SMS_PROVIDER) {
    case 'twilio':
      return new TwilioSMSProvider()
    case 'africas_talking':
      return new AfricasTalkingSMSProvider()
    case 'mock':
      return new MockMessagingProvider('SMS')
    default:
      return new MockMessagingProvider('SMS')
  }
}

export interface FallbackAttempt {
  channel: 'WHATSAPP' | 'SMS'
  provider: string
  success: boolean
  error?: string
}

export interface FallbackResult {
  success: boolean
  attempts: FallbackAttempt[]
  providerUsed?: string
  channelUsed?: 'WHATSAPP' | 'SMS'
  providerMessageId?: string
}

/**
 * Sending strategy (master prompt 3A): try WhatsApp first; on failure fall
 * back to SMS when MESSAGING_FALLBACK_TO_SMS is not explicitly 'false'.
 * Both attempts are reported so the caller can log them.
 */
export async function sendWithFallback(
  to: string,
  message: MessagePayload,
  preferredChannel: 'WHATSAPP' | 'SMS' = 'WHATSAPP'
): Promise<FallbackResult> {
  const attempts: FallbackAttempt[] = []

  const tryProvider = async (provider: MessagingProvider): Promise<FallbackResult> => {
    const result: SendResult = await provider.sendMessage(to, message)
    attempts.push({
      channel: provider.channel,
      provider: provider.name,
      success: result.success,
      error: result.error,
    })
    return {
      success: result.success,
      attempts,
      providerUsed: result.success ? provider.name : undefined,
      channelUsed: result.success ? provider.channel : undefined,
      providerMessageId: result.providerMessageId,
    }
  }

  const primary = preferredChannel === 'SMS' ? getSMSProvider() : getWhatsAppProvider()
  const primaryResult = await tryProvider(primary)
  if (primaryResult.success) return primaryResult

  const fallbackAllowed = process.env.MESSAGING_FALLBACK_TO_SMS !== 'false'
  const shouldFallback =
    fallbackAllowed && preferredChannel === 'WHATSAPP' && primary.channel === 'WHATSAPP'
  if (shouldFallback) {
    return tryProvider(getSMSProvider())
  }
  return { ...primaryResult, attempts }
}
