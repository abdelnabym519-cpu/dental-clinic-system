'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useLanguage } from '@/components/providers/language-provider'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MedicalHistoryView, type MedicalHistoryData } from '@/components/patients/medical-history-view'

// Issue 5 — /patients/[id]/medical-history (was a 404: the patients list
// linked here but the route never existed). Full-page rendering of the
// recorded medical history; the patient-file tab embeds the same view.

export default function MedicalHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { t } = useLanguage()
  const [patient, setPatient] = useState<(MedicalHistoryData & { firstName: string; lastName: string }) | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    fetch(`/api/patients/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => setPatient(data.patient ?? data.data ?? data))
      .catch(() => setNotFound(true))
  }, [id])

  return (
    <div className="container mx-auto p-6 max-w-4xl" data-testid="medical-history-page">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {t('التاريخ الطبي')}
          {patient ? ` — ${patient.firstName} ${patient.lastName}` : ''}
        </h1>
        <Button variant="outline" asChild>
          <Link href={`/patients/${id}`}>
            <ArrowLeft className="h-4 w-4" />
            {t('عودة لملف المريض')}
          </Link>
        </Button>
      </div>

      {notFound ? (
        <p className="p-6 text-sm text-muted-foreground">{t('تعذر العثور على بيانات المريض')}</p>
      ) : patient ? (
        <MedicalHistoryView patient={patient} />
      ) : (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('ui.loading')}
          </div>
        </div>
      )}
    </div>
  )
}
