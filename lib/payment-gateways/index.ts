import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/encryption'
import { FawryGateway } from './fawry'
import { PaymobGateway } from './paymob'
import { InstapayGateway } from './instapay'
import type { PaymentGateway, GatewayCredentials } from './types'

export type { PaymentGateway, GatewayCredentials }
export type {
  GatewayOrder,
  CheckoutConfig,
  VerifyPaymentParams,
  VerifyPaymentResult,
} from './types'

/**
 * Get the payment gateway adapter for a hospital.
 * Reads credentials from DB, decrypts secrets, returns the correct adapter.
 */
export async function getGateway(hospitalId: string): Promise<{
  gateway: PaymentGateway
  credentials: GatewayCredentials
} | null> {
  const config = await prisma.paymentGatewayConfig.findUnique({
    where: { hospitalId },
  })

  if (!config || !config.isEnabled) {
    return null
  }

  const credentials: GatewayCredentials = {
    provider: config.provider,
    isLiveMode: config.isLiveMode,
    webhookSecret: config.webhookSecret || undefined,
  }

  // Decrypt secrets based on provider
  switch (config.provider) {
    case 'FAWRY':
      credentials.fawryMerchantCode = config.fawryMerchantCode || undefined
      credentials.fawrySecretKey = config.fawrySecretKey ? decrypt(config.fawrySecretKey) : undefined
      break
    case 'PAYMOB':
      credentials.paymobApiKey = config.paymobApiKey ? decrypt(config.paymobApiKey) : undefined
      credentials.paymobIntegrationId = config.paymobIntegrationId || undefined
      credentials.paymobIframeId = config.paymobIframeId || undefined
      break
    case 'INSTAPAY':
      credentials.instapayHandle = config.instapayHandle || undefined
      break
  }

  const gateway = createGateway(credentials)
  return { gateway, credentials }
}

/**
 * Create a gateway adapter instance from credentials.
 */
function createGateway(credentials: GatewayCredentials): PaymentGateway {
  switch (credentials.provider) {
    case 'FAWRY':
      return new FawryGateway(credentials)
    case 'PAYMOB':
      return new PaymobGateway(credentials)
    case 'INSTAPAY':
      return new InstapayGateway(credentials)
    default:
      throw new Error(`Unsupported payment provider: ${credentials.provider}`)
  }
}
