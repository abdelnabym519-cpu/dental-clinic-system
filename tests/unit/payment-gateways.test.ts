import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac, createHash } from 'crypto'
import { FawryGateway } from '@/lib/payment-gateways/fawry'
import { PaymobGateway } from '@/lib/payment-gateways/paymob'
import { InstapayGateway } from '@/lib/payment-gateways/instapay'
import type {
  CreateOrderParams,
  GatewayCredentials,
  GatewayOrder,
} from '@/lib/payment-gateways/types'

// ---- Shared test fixtures (Egyptian) ----

const ORDER_PARAMS: CreateOrderParams = {
  amount: 1500,
  currency: 'EGP',
  invoiceId: 'INV-2026-001',
  receipt: 'INV-2026-001',
  customerName: 'محمد أحمد السيد',
  customerEmail: 'mohamed@example.com',
  customerPhone: '01012345678',
}

const FAWRY_CREDS: GatewayCredentials = {
  provider: 'FAWRY',
  isLiveMode: false,
  fawryMerchantCode: 'EG-MERCHANT-001',
  fawrySecretKey: 'fawry-secret-key',
}

const PAYMOB_CREDS: GatewayCredentials = {
  provider: 'PAYMOB',
  isLiveMode: false,
  paymobApiKey: 'paymob-api-key',
  paymobIntegrationId: '456123',
  paymobIframeId: '789456',
}

const INSTAPAY_CREDS: GatewayCredentials = {
  provider: 'INSTAPAY',
  isLiveMode: false,
  instapayHandle: 'dentora@instapay',
  webhookSecret: 'instapay-webhook-secret',
}

// ---- fetch mock ----

const mockFetch = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
})

// ==========================================================================
// Fawry Gateway (Egypt)
// ==========================================================================

describe('FawryGateway', () => {
  it('requires merchant code and secret key', () => {
    expect(() => new FawryGateway({ provider: 'FAWRY', isLiveMode: false })).toThrow(
      /Fawry credentials/
    )
  })

  it('creates a signed charge request and returns a pending order', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ referenceNumber: 'FWRY-99001', checkoutUrl: 'https://atfawry.fawrystaging.com/pay/99001' }),
        { status: 200 }
      )
    )

    const gateway = new FawryGateway(FAWRY_CREDS)
    const order = await gateway.createOrder(ORDER_PARAMS)

    expect(order.provider).toBe('fawry')
    expect(order.status).toBe('PENDING')
    expect(order.orderId).toBe('FWRY-99001')
    expect(order.currency).toBe('EGP')
    expect(String(order.metadata?.redirectUrl)).toContain('/pay/99001')

    const [, init] = mockFetch.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.merchantCode).toBe('EG-MERCHANT-001')
    expect(body.language).toBe('ar-eg')
    expect(body.currencyCode).toBe('EGP')
    expect(body.chargeItems[0].price).toBe(150000) // piasters
    expect(body.chargeItems[0].itemId).toBe('INV-2026-001')
    expect(body.merchantRefNum).toMatch(/^INV-2026-001-\d+$/)

    // signature = sha256(merchantCode + merchantRefNum + secretKey)
    const expected = createHash('sha256')
      .update(body.merchantCode + body.merchantRefNum + 'fawry-secret-key')
      .digest('hex')
    expect(body.signature).toBe(expected)
  })

  it('verifies payment status PAID', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'PAID',
          fawryRefNumber: 'FWRY-99001',
          amount: 150000,
          paymentMethod: 'CARD',
        }),
        { status: 200 }
      )
    )

    const gateway = new FawryGateway(FAWRY_CREDS)
    const result = await gateway.verifyPayment({ orderId: 'FWRY-99001', paymentId: 'FWRY-99001', signature: '' })

    expect(result.verified).toBe(true)
    expect(result.status).toBe('PAID')
    expect(result.amount).toBe(1500)
    expect(result.method).toBe('CARD')
  })

  it('does not verify unpaid status', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'UNPAID', fawryRefNumber: 'FWRY-99001' }), { status: 200 })
    )

    const gateway = new FawryGateway(FAWRY_CREDS)
    const result = await gateway.verifyPayment({ orderId: 'FWRY-99001', paymentId: 'FWRY-99001', signature: '' })

    expect(result.verified).toBe(false)
  })

  it('verifies webhook signature sha256(ref+merchantRef+status+amount+method+secret)', () => {
    const gateway = new FawryGateway(FAWRY_CREDS)
    const payload = {
      fawryRefNumber: 'FWRY-99001',
      merchantRefNum: 'INV-2026-001-1700000000000',
      orderStatus: 'PAID',
      paymentAmount: 1500.0,
      paymentMethod: 'CARD',
    }
    const body = JSON.stringify(payload)
    const signature = createHash('sha256')
      .update(
        payload.fawryRefNumber +
          payload.merchantRefNum +
          payload.orderStatus +
          String(payload.paymentAmount) +
          payload.paymentMethod +
          'fawry-secret-key'
      )
      .digest('hex')

    expect(gateway.verifyWebhook(body, signature, 'ignored-secret')).toBe(true)
    expect(gateway.verifyWebhook(body, signature.replace(/./, '0'), 'ignored-secret')).toBe(false)
  })

  it('rejects malformed webhook payloads', () => {
    const gateway = new FawryGateway(FAWRY_CREDS)
    expect(gateway.verifyWebhook('not-json', 'sig', 'secret')).toBe(false)
  })

  it('returns hosted checkout config from order metadata', () => {
    const gateway = new FawryGateway(FAWRY_CREDS)
    const order: GatewayOrder = {
      orderId: 'FWRY-99001',
      amount: 1500,
      currency: 'EGP',
      receipt: 'INV-2026-001',
      provider: 'fawry',
      status: 'PENDING',
      metadata: { redirectUrl: 'https://atfawry.fawrystaging.com/pay/99001' },
    }
    const config = gateway.getCheckoutConfig(order, FAWRY_CREDS)
    expect(config.provider).toBe('fawry')
    expect(config.redirectUrl).toContain('/pay/99001')
    expect(config.orderId).toBe('FWRY-99001')
  })

  it('initiates refunds against the Fawry refund endpoint', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ referenceNumber: 'RFD-1', status: 'SUCCESS' }), { status: 200 })
    )

    const gateway = new FawryGateway(FAWRY_CREDS)
    const refund = await gateway.initiateRefund({ paymentId: 'FWRY-99001', amount: 500, reason: 'duplicate' })

    expect(refund.success).toBe(true)
    expect(refund.amount).toBe(500)
    const [, init] = mockFetch.mock.calls[0]
    expect(JSON.parse(init.body).refundAmount).toBe(50000) // piasters
  })
})

// ==========================================================================
// Paymob Gateway (Accept, Egypt)
// ==========================================================================

describe('PaymobGateway', () => {
  it('requires api key and integration id', () => {
    expect(() => new PaymobGateway({ provider: 'PAYMOB', isLiveMode: false })).toThrow(
      /Paymob credentials/
    )
  })

  it('creates auth → order → payment key and returns an iframe redirect', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'AUTH-TOKEN' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 424242 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'PAY-KEY' }), { status: 201 }))

    const gateway = new PaymobGateway(PAYMOB_CREDS)
    const order = await gateway.createOrder(ORDER_PARAMS)

    expect(order.provider).toBe('paymob')
    expect(order.orderId).toBe('424242')
    expect(order.status).toBe('PENDING')
    expect(String(order.metadata?.redirectUrl)).toBe(
      'https://accept.paymob.com/api/acceptance/iframes/789456?payment_token=PAY-KEY'
    )

    // order call carries amount in piasters and an Egyptian merchant order id
    const orderCall = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(orderCall.amount_cents).toBe(150000)
    expect(orderCall.currency).toBe('EGP')
    expect(orderCall.merchant_order_id).toMatch(/^INV-2026-001-\d+$/)

    // billing data is Egyptian
    const keyCall = JSON.parse(mockFetch.mock.calls[2][1].body)
    expect(keyCall.billing_data.country).toBe('EG')
    expect(keyCall.billing_data.city).toBe('Cairo')
    expect(keyCall.integration_id).toBe(456123)
  })

  it('verifies payment via order state SUCCESS', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'AUTH-TOKEN' }), { status: 201 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 987654,
            state: 'SUCCESS',
            amount_cents: 150000,
            paid_amount_cents: 150000,
            source: { type: 'card' },
          }),
          { status: 200 }
        )
      )

    const gateway = new PaymobGateway(PAYMOB_CREDS)
    const result = await gateway.verifyPayment({ orderId: '424242', paymentId: '987654', signature: '' })

    expect(result.verified).toBe(true)
    expect(result.amount).toBe(1500)
    expect(result.method).toBe('card')
  })

  it('verifies webhook HMAC-SHA512 over the canonical field order', () => {
    const gateway = new PaymobGateway(PAYMOB_CREDS)
    const tx = {
      amount_cents: 150000,
      created_at: '2026-02-15T10:30:00Z',
      currency: 'EGP',
      error_success: null,
      merchant_order_id: 'INV-2026-001-1700000000000',
      order_id: 424242,
      paid_amount_cents: 150000,
      pending: false,
      source_data: { pan: '1234', sub_type: 'MasterCard', type: 'card' },
      success: true,
    }
    const body = JSON.stringify({ type: 'TRANSACTION', obj: tx })
    const concatenated =
      String(tx.amount_cents) +
      tx.created_at +
      tx.currency +
      '' +
      tx.merchant_order_id +
      String(tx.order_id) +
      String(tx.paid_amount_cents) +
      String(tx.pending) +
      tx.source_data.pan +
      tx.source_data.sub_type +
      tx.source_data.type +
      String(tx.success)
    const signature = createHmac('sha512', 'webhook-secret').update(concatenated).digest('hex')

    expect(gateway.verifyWebhook(body, signature, 'webhook-secret')).toBe(true)
    expect(gateway.verifyWebhook(body, signature.replace(/./, 'f'), 'webhook-secret')).toBe(false)
  })

  it('rejects malformed webhook payloads', () => {
    const gateway = new PaymobGateway(PAYMOB_CREDS)
    expect(gateway.verifyWebhook('not-json', 'sig', 'secret')).toBe(false)
  })

  it('returns hosted checkout config from order metadata', () => {
    const gateway = new PaymobGateway(PAYMOB_CREDS)
    const order: GatewayOrder = {
      orderId: '424242',
      amount: 1500,
      currency: 'EGP',
      receipt: 'INV-2026-001',
      provider: 'paymob',
      status: 'PENDING',
      metadata: {
        redirectUrl: 'https://accept.paymob.com/api/acceptance/iframes/789456?payment_token=PAY-KEY',
      },
    }
    const config = gateway.getCheckoutConfig(order, PAYMOB_CREDS)
    expect(config.provider).toBe('paymob')
    expect(String(config.redirectUrl)).toContain('payment_token=PAY-KEY')
    expect(config.orderId).toBe('424242')
  })

  it('initiates refunds against the Paymob refund endpoint', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'AUTH-TOKEN' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 555001, pending: true }), { status: 201 }))

    const gateway = new PaymobGateway(PAYMOB_CREDS)
    const refund = await gateway.initiateRefund({ paymentId: '987654', amount: 500 })

    expect(refund.success).toBe(true)
    expect(refund.status).toBe('PENDING')
    const refundCall = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(refundCall.amount_cents).toBe(50000)
    expect(refundCall.transaction_id).toBe('987654')
  })
})

// ==========================================================================
// InstaPay Gateway (Egypt)
// ==========================================================================

describe('InstapayGateway', () => {
  it('requires an InstaPay handle', () => {
    expect(() => new InstapayGateway({ provider: 'INSTAPAY', isLiveMode: false })).toThrow(
      /InstaPay credentials/
    )
  })

  it('generates a unique IP- reference without any network call', async () => {
    const gateway = new InstapayGateway(INSTAPAY_CREDS)
    const order = await gateway.createOrder(ORDER_PARAMS)

    expect(mockFetch).not.toHaveBeenCalled()
    expect(order.provider).toBe('instapay')
    expect(order.status).toBe('PENDING')
    expect(order.orderId).toMatch(/^IP-INV-2026-001-[0-9a-f]{8}$/)
    expect(order.metadata?.instapayHandle).toBe('dentora@instapay')
    expect(String(order.metadata?.redirectUrl)).toContain('/pay/instapay?reference=')
  })

  it('verifies payments only on explicit confirmation', async () => {
    const gateway = new InstapayGateway(INSTAPAY_CREDS)

    const confirmed = await gateway.verifyPayment({
      orderId: 'IP-INV-2026-001-abcdef12',
      paymentId: 'BANK-TRX-1',
      signature: '',
      confirmed: true,
      amount: 1500,
    })
    expect(confirmed.verified).toBe(true)
    expect(confirmed.status).toBe('PAID')
    expect(confirmed.method).toBe('instapay')

    const unconfirmed = await gateway.verifyPayment({
      orderId: 'IP-INV-2026-001-abcdef12',
      paymentId: '',
      signature: '',
    })
    expect(unconfirmed.verified).toBe(false)
    expect(unconfirmed.status).toBe('PENDING')
  })

  it('verifies webhook HMAC-SHA256 over the raw body', () => {
    const gateway = new InstapayGateway(INSTAPAY_CREDS)
    const body = JSON.stringify({ reference: 'IP-INV-2026-001-abcdef12', status: 'COMPLETED' })
    const signature = createHmac('sha256', 'instapay-webhook-secret').update(body).digest('hex')

    expect(gateway.verifyWebhook(body, signature, 'instapay-webhook-secret')).toBe(true)
    expect(gateway.verifyWebhook(body, signature.replace(/./, 'a'), 'instapay-webhook-secret')).toBe(false)
  })

  it('rejects webhooks when no secret is configured', () => {
    const gateway = new InstapayGateway({ provider: 'INSTAPAY', isLiveMode: false, instapayHandle: 'dentora@instapay' })
    expect(gateway.verifyWebhook('{}', 'sig', '')).toBe(false)
  })

  it('surfaces the handle, reference and amount in checkout config', () => {
    const gateway = new InstapayGateway(INSTAPAY_CREDS)
    const order: GatewayOrder = {
      orderId: 'IP-INV-2026-001-abcdef12',
      amount: 1500,
      currency: 'EGP',
      receipt: 'INV-2026-001',
      provider: 'instapay',
      status: 'PENDING',
      metadata: { reference: 'IP-INV-2026-001-abcdef12', redirectUrl: '/pay/instapay?reference=x&amount=1500' },
    }
    const config = gateway.getCheckoutConfig(order, INSTAPAY_CREDS)
    expect(config.provider).toBe('instapay')
    expect(config.instapayHandle).toBe('dentora@instapay')
    expect(config.reference).toBe('IP-INV-2026-001-abcdef12')
    expect(config.amount).toBe(1500)
  })

  it('acknowledges refunds as pending external transfers', async () => {
    const gateway = new InstapayGateway(INSTAPAY_CREDS)
    const refund = await gateway.initiateRefund({ paymentId: 'IP-INV-2026-001-abcdef12', amount: 300 })

    expect(refund.success).toBe(true)
    expect(refund.status).toBe('PENDING')
    expect(refund.refundId).toMatch(/^IPR-[0-9a-f]{8}$/)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
