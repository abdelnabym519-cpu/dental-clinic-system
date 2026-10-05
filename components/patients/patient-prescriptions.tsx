'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/components/providers/language-provider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Download, FileText, Loader2 } from 'lucide-react'

// Issue 5 — prescriptions tab inside the patient file. Lists the patient's
// e-prescriptions (Phase 11 workflow: DRAFT → SIGNED → SENT) with the
// existing PDF download route; the API is the existing
// GET /api/prescriptions?patientId=… (tenant-scoped server-side).

interface PrescriptionRow {
  id: string
  prescriptionNo: string
  status: 'DRAFT' | 'SIGNED' | 'SENT' | string
  createdAt: string
  issuedAt?: string | null
  diagnosis?: string | null
  doctor?: { firstName: string; lastName: string } | null
  medications?: { medicationName: string; dosage: string; frequency: string; duration: string }[]
}

const STATUS_AR: Record<string, string> = {
  DRAFT: 'مسودة',
  SIGNED: 'موقعة',
  SENT: 'مرسلة',
  CANCELLED: 'ملغاة',
}

export function PatientPrescriptions({ patientId }: { patientId: string }) {
  const { t } = useLanguage()
  const [rows, setRows] = useState<PrescriptionRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const reload = () =>
    fetch(`/api/prescriptions?patientId=${encodeURIComponent(patientId)}&limit=50`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => setRows(data.data ?? []))
      .catch(() => setFailed(true))

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId])

  // Issue 5 — cancel (never delete) an issued prescription: the clinical
  // record stays visible and auditable with the ملغاة badge.
  const handleCancel = async (rxId: string) => {
    setCancellingId(rxId)
    try {
      const res = await fetch(`/api/prescriptions/${rxId}/cancel`, { method: 'POST' })
      if (res.ok) {
        await reload()
      }
    } finally {
      setCancellingId(null)
    }
  }

  if (failed) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">{t('تعذر تحميل الوصفات الطبية')}</CardContent>
      </Card>
    )
  }

  if (rows === null) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('ui.loading')}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          {t('لا توجد وصفات طبية لهذا المريض بعد — تُنشأ الوصفة من صفحة الوصفات الطبية.')}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card data-testid="patient-prescriptions">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="h-4 w-4" />
          {t('الوصفات الطبية')} ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((rx) => (
          <div key={rx.id} className="rounded-lg border p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{rx.prescriptionNo}</span>
                <Badge
                  variant={
                    rx.status === 'SENT'
                      ? 'default'
                      : rx.status === 'CANCELLED'
                        ? 'destructive'
                        : rx.status === 'SIGNED'
                          ? 'secondary'
                          : 'outline'
                  }
                >
                  {STATUS_AR[rx.status] ?? rx.status}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                {rx.status !== 'CANCELLED' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={cancellingId === rx.id}
                    onClick={() => handleCancel(rx.id)}
                    data-testid={`cancel-rx-${rx.id}`}
                  >
                    {cancellingId === rx.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t('إلغاء الروشتة')
                    )}
                  </Button>
                )}
                <Button variant="outline" size="sm" asChild>
                  <a href={`/api/documents/prescription/${rx.id}`} target="_blank" rel="noreferrer">
                    <Download className="h-4 w-4" />
                    {t('تحميل PDF')}
                  </a>
                </Button>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              {rx.doctor ? `د. ${rx.doctor.firstName} ${rx.doctor.lastName}` : ''} —{' '}
              {new Date(rx.createdAt).toLocaleDateString('ar-EG')}
              {rx.diagnosis ? ` — ${rx.diagnosis}` : ''}
            </div>
            {rx.medications && rx.medications.length > 0 && (
              <ul className="text-sm space-y-1">
                {rx.medications.map((m, i) => (
                  <li key={i}>
                    • {m.medicationName} — {m.dosage}، {m.frequency}، {m.duration}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
