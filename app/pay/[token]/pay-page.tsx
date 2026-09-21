'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  CreditCard,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  Building2,
  Phone,
  Mail,
  MapPin,
} from 'lucide-react'
import { formatCurrency as formatAmount } from '@/lib/i18n/format'

interface PayPageProps {
  token: string
  /** Resolved server-side from the clinic, with `?lang=` for this render only. */
  locale: string
  /** The clinic's ISO 4217 currency — independent of the display locale. */
  currency: string
  hospital: {
    name: string
    logo: string | null
    phone: string | null
    email: string | null
    address: string | null
    city: string | null
    state: string | null
  }
  invoice: {
    id: string
    invoiceNo: string
    totalAmount: number
    paidAmount: number
    balanceAmount: number
  }
  patient: {
    name: string
    phone: string
  }
  amount: number
  isExpired: boolean
  isUsed: boolean
  isPaid: boolean
}

type PayState = 'idle' | 'loading' | 'checkout' | 'verifying' | 'success' | 'error'

export function PayPage({
  token,
  locale,
  currency,
  hospital,
  invoice,
  patient,
  amount,
  isExpired,
  isUsed,
  isPaid,
}: PayPageProps) {
  const { t } = useLanguage()
  const [state, setState] = useState<PayState>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const formatCurrency = (val: number) =>
    formatAmount(val, { locale, currency, minimumFractionDigits: 0 })

  const canPay = !isExpired && !isUsed && !isPaid && amount > 0

  const initiatePayment = useCallback(async () => {
    try {
      setState('loading')
      setErrorMsg('')

      // Create order via public endpoint (uses token-based auth)
      const orderRes = await fetch('/api/payments/public-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, amount }),
      })

      if (!orderRes.ok) {
        const data = await orderRes.json()
        throw new Error(data.error || 'Failed to create payment')
      }

      const orderData = await orderRes.json()
      const { checkout, order } = orderData

      setState('checkout')

      switch (checkout.provider) {
        case 'fawry':
        case 'paymob':
        case 'instapay':
          handleRedirect(checkout.redirectUrl)
          break
        default:
          throw new Error('Unsupported provider')
      }
    } catch (err: unknown) {
      setState('error')
      setErrorMsg(err instanceof Error ? err.message : 'Payment failed')
    }
  }, [token, amount])

  const handleRedirect = (url: string) => {
    if (url) window.location.href = url
    else {
      setState('error')
      setErrorMsg('Redirect URL not available')
    }
  }


  const verifyPayment = async (params: Record<string, string>) => {
    setState('verifying')
    try {
      const res = await fetch('/api/payments/public-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Verification failed')
      }
      setState('success')
    } catch (err: unknown) {
      setState('error')
      setErrorMsg(err instanceof Error ? err.message : 'Verification failed')
    }
  }

  return (
    <div className="min-h-screen bg-muted/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center pb-4">
          {hospital.logo ? (
            <img
              src={hospital.logo}
              alt={hospital.name}
              className="h-16 w-16 rounded-lg object-cover mx-auto mb-2"
            />
          ) : (
            <div className="h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-2">
              <Building2 className="h-8 w-8 text-primary" />
            </div>
          )}
          <CardTitle className="text-xl">{hospital.name}</CardTitle>
          <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
            {hospital.phone && (
              <span className="flex items-center gap-1">
                <Phone className="h-3 w-3" /> {hospital.phone}
              </span>
            )}
            {hospital.email && (
              <span className="flex items-center gap-1">
                <Mail className="h-3 w-3" /> {hospital.email}
              </span>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Status messages */}
          {isExpired && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 text-yellow-700 text-sm">
              <Clock className="h-4 w-4" />
              {t('This payment link has expired. Please contact the clinic for a new link.')}
            </div>
          )}
          {isUsed && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 text-blue-700 text-sm">
              <CheckCircle className="h-4 w-4" />
              {t('This payment link has already been used.')}
            </div>
          )}
          {isPaid && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 text-green-700 text-sm">
              <CheckCircle className="h-4 w-4" />
              This invoice has been fully paid. Thank you!
            </div>
          )}

          {/* Invoice details */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('ui.invoice')}</span>
              <span className="font-medium">{invoice.invoiceNo}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('ui.patient')}</span>
              <span>{patient.name}</span>
            </div>
            <Separator />
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('ui.total_amount')}</span>
              <span>{formatCurrency(invoice.totalAmount)}</span>
            </div>
            {invoice.paidAmount > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>{t('ui.paid')}</span>
                <span>{formatCurrency(invoice.paidAmount)}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-semibold">
              <span>{t('Amount Due')}</span>
              <span className="text-lg">{formatCurrency(amount)}</span>
            </div>
          </div>

          {/* Payment button / states */}
          {state === 'idle' && canPay && (
            <Button className="w-full" size="lg" onClick={initiatePayment}>
              <CreditCard className="h-4 w-4 mr-2" />
              Pay {formatCurrency(amount)}
            </Button>
          )}

          {(state === 'loading' || state === 'checkout') && (
            <div className="flex flex-col items-center py-4 gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                {state === 'loading' ? 'Preparing payment...' : 'Waiting for payment...'}
              </p>
            </div>
          )}

          {state === 'verifying' && (
            <div className="flex flex-col items-center py-4 gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">{t('ui.verifying_payment')}</p>
            </div>
          )}

          {state === 'success' && (
            <div className="flex flex-col items-center py-6 gap-3">
              <CheckCircle className="h-12 w-12 text-green-500" />
              <p className="font-medium text-green-700">{t('Payment Successful!')}</p>
              <p className="text-sm text-muted-foreground text-center">
                {formatCurrency(amount)} has been received for invoice {invoice.invoiceNo}. Thank
                you!
              </p>
            </div>
          )}

          {state === 'error' && (
            <div className="flex flex-col items-center py-4 gap-3">
              <AlertCircle className="h-10 w-10 text-red-500" />
              <p className="font-medium text-red-600">{t('ui.payment_failed')}</p>
              <p className="text-sm text-muted-foreground text-center">{errorMsg}</p>
              {canPay && (
                <Button onClick={initiatePayment} variant="outline">{t('ui.try_again')}</Button>
              )}
            </div>
          )}

          <p className="text-xs text-center text-muted-foreground">
            {t("Secure payment powered by your clinic's payment gateway")}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

