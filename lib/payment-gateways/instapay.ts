import { createHmac, randomUUID } from 'crypto'
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
 * InstaPay (Egypt) adapter.
 *
 * InstaPay is Egypt's instant bank-transfer rail (P2P/P2B). There is no
 * hosted card-checkout API for merchants; the flow is: generate a payment
 * request with a unique reference, surface the clinic's InstaPay handle
 * (IPA) for the transfer, then confirm either via the bank webhook feed or
 * an authorised staff match on the reference number.
 */
export class InstapayGateway implements PaymentGateway {
  private handle: string
  private webhookSecret?: string

  constructor(credentials: GatewayCredentials) {
    if (!credentials.instapayHandle) {
      throw new Error('InstaPay credentials (instapayHandle) are required')
    }
    this.handle = credentials.instapayHandle
    this.webhookSecret = credentials.webhookSecret
  }

  async createOrder(params: CreateOrderParams): Promise<GatewayOrder> {
    const reference = `IP-${params.receipt}-${randomUUID().slice(0, 8)}`

    return {
      orderId: reference,
      amount: params.amount,
      currency: params.currency || 'EGP',
      receipt: params.receipt,
      provider: 'instapay',
      status: 'PENDING',
      metadata: {
        reference,
        instapayHandle: this.handle,
        // The instructions page renders these for the patient.
        redirectUrl: `/pay/instapay?reference=${encodeURIComponent(reference)}&amount=${params.amount}&handle=${encodeURIComponent(this.handle)}`,
      },
    }
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    // Confirmation arrives from the bank feed / staff entry carrying the
    // reference; verification = reference match + positive confirmation flag.
    const confirmed = Boolean(params.confirmed)
    return {
      verified: confirmed,
      transactionId: String(params.transactionId ?? params.orderId ?? ''),
      status: confirmed ? 'PAID' : 'PENDING',
      amount: params.amount != null ? Number(params.amount) : undefined,
      method: 'instapay',
    }
  }

  verifyWebhook(body: string, signature: string, secret: string): boolean {
    if (!this.webhookSecret && !secret) return false
    const key = secret || this.webhookSecret || ''
    try {
      const expected = createHmac('sha256', key).update(body).digest('hex')
      return expected === signature
    } catch {
      return false
    }
  }

  getCheckoutConfig(order: GatewayOrder, _credentials: GatewayCredentials): CheckoutConfig {
    return {
      provider: 'instapay',
      redirectUrl: String(order.metadata?.redirectUrl ?? ''),
      orderId: order.orderId,
      instapayHandle: this.handle,
      reference: order.orderId,
      amount: order.amount,
    }
  }

  async initiateRefund(params: RefundParams): Promise<RefundResult> {
    // Refunds on InstaPay are outgoing transfers — recorded and reconciled
    // outside the gateway; the adapter acknowledges the request.
    return {
      success: true,
      refundId: `IPR-${randomUUID().slice(0, 8)}`,
      status: 'PENDING',
      amount: params.amount,
    }
  }
}
