'use client'

import { useLanguage } from '@/components/providers/language-provider'
import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Pill, User, Calendar, ChevronDown, ChevronUp, FileDown, MessageCircle, Check, Loader2 } from 'lucide-react'

interface Prescription {
  id: string
  prescriptionNo: string
  createdAt: string
  diagnosis: string | null
  notes: string | null
  doctor: {
    firstName: string
    lastName: string
    specialization: string | null
  }
  medications: Array<{
    id: string
    medication: {
      name: string
      genericName: string | null
      form: string | null
      strength: string | null
    } | null
    medicationName: string
    dosage: string
    frequency: string
    duration: string
    instructions: string | null
    quantity: number | null
  }>
}

export default function PatientPrescriptions() {
  const { locale } = useLanguage()
  const { t } = useLanguage()
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [resentId, setResentId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/patient-portal/prescriptions')
      .then((r) => r.json())
      .then((data) => setPrescriptions(data.prescriptions || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const requestResend = async (id: string) => {
    setResendingId(id)
    setResentId(null)
    try {
      const res = await fetch(`/api/patient-portal/prescriptions/${id}/resend`, {
        method: 'POST',
      })
      if (res.ok) setResentId(id)
    } catch (err) {
      console.error(err)
    } finally {
      setResendingId(null)
    }
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{t('ui.prescriptions')}</h1>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('ui.prescriptions')}</h1>

      {prescriptions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Pill className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>{t('No prescriptions yet')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {prescriptions.map((rx) => (
            <Card key={rx.id}>
              <CardContent className="py-4">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandedId(expandedId === rx.id ? null : rx.id)}
                >
                  <div className="space-y-1">
                    <p className="font-medium">{rx.prescriptionNo}</p>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {t("Dr.")} {rx.doctor.firstName} {rx.doctor.lastName}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(rx.createdAt)}
                      </span>
                    </div>
                    {rx.diagnosis && (
                      <p className="text-sm text-muted-foreground">{t("Diagnosis:")} {rx.diagnosis}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{rx.medications.length} {t('meds')}</Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={t('Download PDF')}
                      title={t('Download PDF')}
                      onClick={(e) => {
                        e.stopPropagation()
                        window.open(`/api/patient-portal/prescriptions/${rx.id}/pdf`, '_blank')
                      }}
                    >
                      <FileDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={t('Resend via WhatsApp')}
                      title={t('Resend via WhatsApp')}
                      disabled={resendingId === rx.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        requestResend(rx.id)
                      }}
                    >
                      {resendingId === rx.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : resentId === rx.id ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <MessageCircle className="h-4 w-4" />
                      )}
                    </Button>
                    {expandedId === rx.id ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {expandedId === rx.id && (
                  <div className="mt-4 space-y-3">
                    <Separator />
                    {rx.medications.map((item) => (
                      <div key={item.id} className="p-3 rounded-lg bg-muted/50 space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm">
                            {item.medication?.name || item.medicationName}
                            {item.medication?.strength && ` ${item.medication.strength}`}
                          </p>
                          {item.quantity && (
                            <Badge variant="outline" className="text-xs">
                              {t("Qty:")} {item.quantity}
                            </Badge>
                          )}
                        </div>
                        {item.medication?.genericName && (
                          <p className="text-xs text-muted-foreground">
                            ({item.medication.genericName})
                          </p>
                        )}
                        <p className="text-sm">
                          {item.dosage} &middot; {item.frequency} &middot; {item.duration}
                        </p>
                        {item.instructions && (
                          <p className="text-xs text-muted-foreground italic">
                            {item.instructions}
                          </p>
                        )}
                      </div>
                    ))}
                    {rx.notes && (
                      <>
                        <Separator />
                        <p className="text-sm text-muted-foreground">
                          <strong>{t("Notes:")}</strong> {rx.notes}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
