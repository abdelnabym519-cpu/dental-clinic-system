'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CreditCard, Loader2, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react'

interface PaymentCheckoutProps {
  invoiceId: string
  amount: number
  invoiceNo: string
  patientName: string
  onSuccess?: () => void
  onClose?: () => void
  open?: boolean
  trigger?: React.ReactNode
}

type CheckoutState = 'idle' | 'loading' | 'checkout' | 'verifying' | 'success' | 'error'

export function PaymentCheckout({
  invoiceId,
  amount,
  invoiceNo,
  patientName,
  onSuccess,
  onClose,
  open: controlledOpen,
  trigger,
}: PaymentCheckoutProps) {
  const { t } = useLanguage()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (val: boolean) => {
    setInternalOpen(val)
    if (!val) onClose?.()
  }

  const [state, setState] = useState<CheckoutState>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleOpenChange = (val: boolean) => {
    if (state === 'verifying' || state === 'loading') return // Prevent close during processing
    setOpen(val)
    if (!val) {
      setState('idle')
      setErrorMsg('')
    }
  }

  const initiatePayment = useCallback(async () => {
    try {
      setState('loading')
      setErrorMsg('')

      // Step 1: Create order
      const orderRes = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId, amount }),
      })

      if (!orderRes.ok) {
        const data = await orderRes.json()
        throw new Error(data.error || 'Failed to create payment order')
      }

      const orderData = await orderRes.json()
      const { checkout, order, hospital, patient } = orderData

      setState('checkout')

      // Step 2: All Egyptian gateways use hosted redirect flows
      // (Fawry checkout, Paymob iframe, InstaPay instructions page).
      switch (checkout.provider) {
        case 'fawry':
        case 'paymob':
        case 'instapay':
          handleRedirectCheckout(checkout)
          break
        default:
          throw new Error(`Unsupported provider: ${checkout.provider}`)
      }
    } catch (err: unknown) {
      setState('error')
      setErrorMsg(err instanceof Error ? err.message : 'Payment failed')
    }
  }, [invoiceId, amount])

  const handleRedirectCheckout = (checkout: Record<string, unknown>) => {
    // Fawry / Paymob / InstaPay all hand back a hosted URL to complete the
    // payment; the return trip lands on /api/webhooks/payment/[provider].
    const redirectUrl = checkout.redirectUrl as string
    if (redirectUrl) {
      window.location.href = redirectUrl
    } else {
      setState('error')
      setErrorMsg('Failed to get the payment redirect URL')
    }
  }

  const verifyPayment = async (params: Record<string, string>) => {
    setState('verifying')
    try {
      const res = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Verification failed')
      }

      setState('success')
      setTimeout(() => {
        setOpen(false)
        setState('idle')
        onSuccess?.()
      }, 2000)
    } catch (err: unknown) {
      setState('error')
      setErrorMsg(err instanceof Error ? err.message : 'Payment verification failed')
    }
  }

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-EG', {
      style: 'currency',
      currency: 'EGP',
      minimumFractionDigits: 0,
    }).format(val)

  return (
    <>
      {trigger ? (
        <div onClick={() => setOpen(true)}>{trigger}</div>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <CreditCard className="h-4 w-4 mr-2" />
          Pay Online
        </Button>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{state === 'success' ? 'Payment Successful' : 'Pay Online'}</DialogTitle>
            <DialogDescription>
              {state === 'success'
                ? 'Your payment has been processed successfully.'
                : `Invoice ${invoiceNo} for ${patientName}`}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {state === 'idle' && (
              <div className="space-y-4">
                <div className="rounded-lg border p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('ui.amount')}</span>
                    <span className="font-semibold text-lg">{formatCurrency(amount)}</span>
                  </div>
                </div>
                <Button className="w-full" size="lg" onClick={initiatePayment}>
                  <CreditCard className="h-4 w-4 mr-2" />
                  Pay {formatCurrency(amount)}
                </Button>
                <p className="text-xs text-center text-muted-foreground">
                  Secured payment via your clinic&apos;s payment gateway
                </p>
              </div>
            )}

            {(state === 'loading' || state === 'checkout') && (
              <div className="flex flex-col items-center py-8 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  {state === 'loading' ? 'Preparing payment...' : 'Waiting for payment...'}
                </p>
              </div>
            )}

            {state === 'verifying' && (
              <div className="flex flex-col items-center py-8 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">{t('ui.verifying_payment')}</p>
              </div>
            )}

            {state === 'success' && (
              <div className="flex flex-col items-center py-8 gap-3">
                <CheckCircle className="h-12 w-12 text-green-500" />
                <p className="font-medium">Payment of {formatCurrency(amount)} received</p>
                <p className="text-sm text-muted-foreground">Invoice {invoiceNo} updated</p>
              </div>
            )}

            {state === 'error' && (
              <div className="flex flex-col items-center py-8 gap-3">
                <AlertCircle className="h-12 w-12 text-red-500" />
                <p className="font-medium text-red-600">{t('ui.payment_failed')}</p>
                <p className="text-sm text-muted-foreground text-center">{errorMsg}</p>
                <Button onClick={initiatePayment} variant="outline">{t('ui.try_again')}</Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`)
    if (existing) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`))
    document.head.appendChild(script)
  })
}
