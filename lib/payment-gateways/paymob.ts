import { createHmac } from 'crypto'
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
 * Paymob (Accept, Egypt) payment gateway adapter.
 *
 * Flow: auth token → order → payment key → hosted iframe redirect.
 * Transaction webhooks are verified with the HMAC-SHA512 secret Paymob
 * provides per account.
 */
export class PaymobGateway implements PaymentGateway {
  private apiKey: string
  private integrationId: string
  private baseUrl = 'https://accept.paymob.com/api'
  private iframeId: string

  constructor(credentials: GatewayCredentials) {
    if (!credentials.paymobApiKey || !credentials.paymobIntegrationId) {
      throw new Error('Paymob credentials (apiKey, integrationId) are required')
    }
    this.apiKey = credentials.paymobApiKey
    this.integrationId = credentials.paymobIntegrationId
    this.iframeId = credentials.paymobIframeId || 'default'
  }

  private async request(path: string, body?: unknown) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json()
    if (!res.ok) {
      throw new Error(data?.detail || `Paymob API error: ${res.status}`)
    }
    return data
  }

  private async authToken(): Promise<string> {
    const data = await this.request('/auth/tokens', { api_key: this.apiKey })
    return data.token as string
  }

  async createOrder(params: CreateOrderParams): Promise<GatewayOrder> {
    const token = await this.authToken()
    const amountCents = Math.round(params.amount * 100)
    const merchantOrderId = `${params.receipt}-${Date.now()}`

    const order = await this.request('/ecommerce/orders', {
      auth_token: token,
      delivery_needed: false,
      amount_cents: amountCents,
      currency: params.currency || 'EGP',
      merchant_order_id: merchantOrderId,
      items: [],
    })

    const paymentKey = await this.request('/acceptance/payment_keys', {
      auth_token: token,
      amount_cents: amountCents,
      expiration: 3600,
      order_id: order.id,
      currency: params.currency || 'EGP',
      integration_id: Number(this.integrationId),
      billing_data: {
        first_name: (params.customerName || 'Patient').split(' ')[0],
        last_name: (params.customerName || 'Patient').split(' ').slice(1).join(' ') || 'Dentora',
        email: params.customerEmail || 'no-email@dentora-dental.com',
        phone_number: params.customerPhone || '+201000000000',
        apartment: 'NA', floor: 'NA', street: 'NA', building: 'NA',
        shipping_method: 'NA', postal_code: 'NA',
        state: 'Cairo', city: 'Cairo', country: 'EG',
      },
    })

    // The payment-keys endpoint returns { token }; tolerate a bare string too.
    const paymentKeyToken =
      typeof paymentKey === 'string' ? paymentKey : String((paymentKey as { token?: string })?.token ?? '')

    return {
      orderId: String(order.id),
      amount: params.amount,
      currency: params.currency || 'EGP',
      receipt: params.receipt,
      provider: 'paymob',
      status: 'PENDING',
      metadata: {
        merchantOrderId,
        paymentKey: paymentKeyToken,
        redirectUrl: `https://accept.paymob.com/api/acceptance/iframes/${this.iframeId}?payment_token=${encodeURIComponent(paymentKeyToken)}`,
      },
    }
  }

  async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const token = await this.authToken()
    const data = await this.request(
      `/ecommerce/orders/${params.orderId}?auth_token=${encodeURIComponent(token)}`
    )
    return {
      verified: data.state === 'SUCCESS' || data.paid_amount_cents >= data.amount_cents,
      transactionId: String(data.id ?? params.paymentId ?? ''),
      status: String(data.state ?? 'UNKNOWN'),
      amount: data.amount_cents != null ? Number(data.amount_cents) / 100 : undefined,
      method: data.source?.type,
    }
  }

  verifyWebhook(body: string, signature: string, secret: string): boolean {
    // Paymob HMAC-SHA512 over selected fields in a fixed order.
    try {
      const parsed = JSON.parse(body)
      const obj = parsed.obj ?? {}
      const concatenated = [
        obj.amount_cents,
        obj.created_at,
        obj.currency,
        obj.error_success,
        obj.merchant_order_id,
        obj.order_id,
        obj.paid_amount_cents,
        obj.pending,
        obj.source_data?.pan,
        obj.source_data?.sub_type,
        obj.source_data?.type,
        obj.success,
      ]
        .map((v) => (v === null || v === undefined ? '' : String(v)))
        .join('')
      const expected = createHmac('sha512', secret).update(concatenated).digest('hex')
      return expected === signature
    } catch {
      return false
    }
  }

  getCheckoutConfig(order: GatewayOrder, _credentials: GatewayCredentials): CheckoutConfig {
    return {
      provider: 'paymob',
      redirectUrl: String(order.metadata?.redirectUrl ?? ''),
      orderId: order.orderId,
    }
  }

  async initiateRefund(params: RefundParams): Promise<RefundResult> {
    const token = await this.authToken()
    const data = await this.request('/acceptance/void_refund/refund', {
      auth_token: token,
      transaction_id: params.paymentId,
      amount_cents: Math.round(params.amount * 100),
    })
    return {
      success: Boolean(data.id),
      refundId: String(data.id ?? ''),
      status: data.pending ? 'PENDING' : 'COMPLETED',
      amount: params.amount,
    }
  }
}
