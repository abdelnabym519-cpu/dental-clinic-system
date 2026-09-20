'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Smartphone,
  CheckCircle,
  Clock,
  Copy,
  Building2,
} from 'lucide-react'

/**
 * InstaPay payment instructions page.
 *
 * InstaPay has no hosted checkout — the patient transfers from their banking
 * app to the clinic's InstaPay address (IPA) using the unique reference.
 * Confirmation happens via the clinic (bank feed / staff match on the
 * reference), so this page only presents the transfer details.
 */
export default function InstaPayInstructionsPage() {
  const [reference, setReference] = useState('')
  const [amount, setAmount] = useState('')
  const [handle, setHandle] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setReference(params.get('reference') || '')
    setAmount(params.get('amount') || '')
    setHandle(params.get('handle') || '')
  }, [])

  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(reference)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable — the reference stays visible for manual copy
    }
  }

  return (
    <div className="min-h-screen bg-muted/40 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Smartphone className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl">الدفع عبر InstaPay</CardTitle>
          <p className="text-sm text-muted-foreground">Complete your payment with InstaPay</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Amount */}
          <div className="rounded-lg border bg-muted/30 p-4 text-center">
            <p className="text-xs text-muted-foreground">المبلغ المطلوب / Amount due</p>
            <p className="text-3xl font-bold">{amount ? `${amount} ج.م` : '—'}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {amount ? `EGP ${Number(amount).toLocaleString('en-EG')}` : ''}
            </p>
          </div>

          {/* InstaPay handle */}
          <div>
            <p className="text-sm font-medium mb-1">حوِّل إلى عنوان InstaPay للعيادة</p>
            <p className="text-sm text-muted-foreground mb-2">
              Transfer to the clinic&apos;s InstaPay address (IPA)
            </p>
            <div className="flex items-center gap-2 rounded-md border p-3 font-mono text-lg" dir="ltr">
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate">{handle || '—'}</span>
            </div>
          </div>

          {/* Reference */}
          <div>
            <p className="text-sm font-medium mb-1">رقم المرجع (اكتبه في تعليمات التحويل)</p>
            <p className="text-sm text-muted-foreground mb-2">
              Payment reference — include it in the transfer note
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-md border p-3 font-mono text-sm truncate" dir="ltr">
                {reference || '—'}
              </div>
              <button
                type="button"
                onClick={copyReference}
                className="shrink-0 rounded-md border p-3 hover:bg-muted"
                aria-label="Copy reference"
              >
                {copied ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <Separator />

          {/* Steps */}
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>افتح تطبيق البنك واختر InstaPay / تحويل فوري</li>
            <li>حوِّل المبلغ إلى العنوان أعلاه</li>
            <li>اكتب رقم المرجع في ملاحظات التحويل</li>
            <li>سيتم تأكيد الدفع من العيادة بعد وصول التحويل</li>
          </ol>

          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <Clock className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              لا تُغلق الصفحة حتى تُكمل التحويل — تأكيد الدفع يظهر في الفاتورة خلال دقائق من
              استلام التحويل. / The clinic confirms the payment once the transfer arrives.
            </p>
          </div>

          <Badge variant="outline" className="w-full justify-center">
            عيادة دنتورا للأسنان — Dentora Dental Clinic
          </Badge>
        </CardContent>
      </Card>
    </div>
  )
}
