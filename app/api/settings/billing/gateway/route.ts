import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { encrypt, decrypt } from '@/lib/encryption'

/**
 * GET: Fetch payment gateway configuration for the hospital.
 * Secrets are masked in response.
 */
export async function GET() {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const config = await prisma.paymentGatewayConfig.findUnique({
    where: { hospitalId },
  })

  if (!config) {
    return NextResponse.json({ config: null })
  }

  // Mask secrets — only show last 4 chars
  const mask = (val: string | null) => (val ? `****${val.slice(-4)}` : null)

  return NextResponse.json({
    config: {
      provider: config.provider,
      isEnabled: config.isEnabled,
      isLiveMode: config.isLiveMode,
      fawryMerchantCode: config.fawryMerchantCode,
      fawrySecretKey: config.fawrySecretKey ? mask(decrypt(config.fawrySecretKey)) : null,
      paymobApiKey: config.paymobApiKey ? mask(decrypt(config.paymobApiKey)) : null,
      paymobIntegrationId: config.paymobIntegrationId,
      paymobIframeId: config.paymobIframeId,
      instapayHandle: config.instapayHandle,
      webhookUrl: `${process.env.NEXTAUTH_URL}/api/webhooks/payment/${config.provider.toLowerCase()}`,
    },
  })
}

/**
 * PUT: Create or update payment gateway configuration.
 */
export async function PUT(req: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const {
    provider,
    isEnabled,
    isLiveMode,
    fawryMerchantCode,
    fawrySecretKey,
    paymobApiKey,
    paymobIntegrationId,
    paymobIframeId,
    instapayHandle,
  } = body

  if (!provider || !['FAWRY', 'PAYMOB', 'INSTAPAY'].includes(provider)) {
    return NextResponse.json(
      { error: 'Valid provider is required (FAWRY, PAYMOB, INSTAPAY)' },
      { status: 400 }
    )
  }

  // Build update data — only encrypt secrets that are actually new (not masked)
  const existing = await prisma.paymentGatewayConfig.findUnique({
    where: { hospitalId },
  })

  const data: Record<string, unknown> = {
    provider,
    isEnabled: isEnabled ?? false,
    isLiveMode: isLiveMode ?? false,
  }

  // Fawry fields
  if (provider === 'FAWRY') {
    data.fawryMerchantCode = fawryMerchantCode || null
    if (fawrySecretKey && !fawrySecretKey.startsWith('****')) {
      data.fawrySecretKey = encrypt(fawrySecretKey)
    } else if (existing?.provider === 'FAWRY') {
      data.fawrySecretKey = existing.fawrySecretKey
    }
    // Clear other provider fields
    data.paymobApiKey = null
    data.paymobIntegrationId = null
    data.paymobIframeId = null
    data.instapayHandle = null
  }

  // Paymob fields
  if (provider === 'PAYMOB') {
    if (paymobApiKey && !paymobApiKey.startsWith('****')) {
      data.paymobApiKey = encrypt(paymobApiKey)
    } else if (existing?.provider === 'PAYMOB') {
      data.paymobApiKey = existing.paymobApiKey
    }
    data.paymobIntegrationId = paymobIntegrationId || null
    data.paymobIframeId = paymobIframeId || null
    // Clear other provider fields
    data.fawryMerchantCode = null
    data.fawrySecretKey = null
    data.instapayHandle = null
  }

  // InstaPay fields
  if (provider === 'INSTAPAY') {
    data.instapayHandle = instapayHandle || null
    // Clear other provider fields
    data.fawryMerchantCode = null
    data.fawrySecretKey = null
    data.paymobApiKey = null
    data.paymobIntegrationId = null
    data.paymobIframeId = null
  }

  const config = await prisma.paymentGatewayConfig.upsert({
    where: { hospitalId },
    create: { hospitalId, ...data } as never,
    update: data as never,
  })

  return NextResponse.json({
    success: true,
    config: {
      provider: config.provider,
      isEnabled: config.isEnabled,
      isLiveMode: config.isLiveMode,
      webhookUrl: `${process.env.NEXTAUTH_URL}/api/webhooks/payment/${config.provider.toLowerCase()}`,
    },
  })
}
