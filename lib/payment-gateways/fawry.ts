import { createHash } from 'crypto'
import type {
  PaymentGateway,
  CreateOrderParams,
  VerifyPaymentParams,
  VerifyPaymentResult,
  GatewayOrder,
  GatewayCredentials,
  CheckoutConfig,
  RefundParams,
  RefundResult,
} from './types'

/**
 * Fawry (Egypt) payment gateway adapter.
 *
 * Uses the Fawry IPC "Charge" API: a signed charge request returns a
 * checkout URL the patient completes on Fawry's side (POS network, cards,
 * mobile wallets). Webhooks carry a SHA-256 signature computed over the
 * response fields concatenated with the secure key.
 */
export class FawryGateway implements PaymentGateway {
  private merchantCode: string
  private secretKey: string
  private baseUrl: string

  constructor(credentials: GatewayCredentials) {
    if (!credentials.fawryMerchantCode || !credentials.fawrySecretKey) {
      throw new Error('Fawry credentials (merchantCode, secretKey) are required')
    }
    this.merchantCode = credentials.fawryMerchantCode
    this.secretKey = credentials.fawrySecretKey
    this.baseUrl = credentials.isLiveMode
      ? 'https://atfawry.fawrystaging.com/ECommerceWeb/Fawry/payments' // live: https://www.atfawry.com/ECommerceWeb/Fawry/payments
      : 'https://atfawry.fawrystaging.com/ECommerceWeb/Fawry/payments'
  }

  private sign(fields: string[]): string {
    return createHash('sha256').update(fields.join('') + this.secretKey).digest('hex')
  }

  async createOrder(params: CreateOrderParams): Promise<GatewayOrder> {
    const merchantRefNum = `${params.receipt}-${Date.now()}`
    const amountPiasters = Math.round(params.amount * 100)
    const signature = this.sign([this.merchantCode, merchantRefNum])

    const res = await fetch(`${this.baseUrl}/charge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantCode: this.merchantCode,
        merchantRefNum,
        customerName: params.customerName,
        customerMobile: params.customerPhone,
        customerEmail: params.customerEmail,
        language: 'ar-eg',
        currencyCode: params.currency || 'EGP',
        signature,
        paymentExpiry: 24 * 60 * 60,
        chargeItems: [
          {
            itemId: params.invoiceId,
            description: `Invoice ${params.receipt}`,
            price: amountPiasters,
            quantity: 1,
          },
        ],
      }),
    })

    const data = await res.json()
    if (!res.ok || (data.type && data.type === 'error')) {
      throw new Error(data?.status?.description || `Fawry API error: ${res.status}`)
    }

    return {
      orderId: data.referenceNumber || merchantRefNum,
      amount: params.amount,
      currency: params.currency || 'EGP',
      receipt: params.receipt,
      provider: 'fawry',
      status: 'PENDING',
      metadata: {
        merchantRefNum,
        // Fawry returns a payable checkout URL for hosted redirect.
        redirectUrl: data.checkoutUrl ?? `${this.baseUrl}/checkout?merchantCode=${this.merchantCode}&merchantRefNum=${merchantRefNum}`,
      },
    }
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const merchantRefNum = String(params.merchantRefNum ?? params.orderId)
    const signature = this.sign([this.merchantCode, merchantRefNum])

    const res = await fetch(
      `${this.baseUrl}/transactionStatus?merchantCode=${this.merchantCode}&merchantRefNumber=${merchantRefNum}&signature=${signature}`,
      { headers: { 'Content-Type': 'application/json' } }
    )
    const data = await res.json()

    return {
      verified: data.status === 'PAID' || data.status === 'PAID_BY_REFERENCED_ITEM',
      transactionId: String(data.fawryRefNumber ?? params.paymentId ?? ''),
      status: String(data.status ?? 'UNKNOWN'),
      amount: data.amount != null ? Number(data.amount) / 100 : undefined,
      method: data.paymentMethod,
    }
  }

  verifyWebhook(body: string, signature: string, _secret: string): boolean {
    // Fawry callback signature: sha256(concatenated response fields + secure key)
    try {
      const parsed = JSON.parse(body)
      const expected = this.sign([
        parsed.fawryRefNumber ?? '',
        parsed.merchantRefNum ?? '',
        parsed.orderStatus ?? '',
        parsed.paymentAmount != null ? String(parsed.paymentAmount) : '',
        parsed.paymentMethod ?? '',
      ])
      return expected === signature
    } catch {
      return false
    }
  }

  getCheckoutConfig(order: GatewayOrder, _credentials: GatewayCredentials): CheckoutConfig {
    return {
      provider: 'fawry',
      redirectUrl: String(order.metadata?.redirectUrl ?? ''),
      orderId: order.orderId,
    }
  }

  async initiateRefund(params: RefundParams): Promise<RefundResult> {
    const res = await fetch(`${this.baseUrl}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantCode: this.merchantCode,
        refundAmount: Math.round(params.amount * 100),
        fawryRefNumber: params.paymentId,
        reason: params.reason || 'Refund requested',
        signature: this.sign([this.merchantCode, params.paymentId]),
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      throw new Error(data?.status?.description || `Fawry refund error: ${res.status}`)
    }
    return {
      success: data.status === 'SUCCESS' || Boolean(data.referenceNumber),
      refundId: data.referenceNumber || data.fawryRefNumber || '',
      status: data.status || 'PENDING',
      amount: params.amount,
    }
  }
}
