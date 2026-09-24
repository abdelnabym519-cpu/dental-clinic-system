'use client'

import { use } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/components/providers/language-provider'
import { DentalChart } from '@/components/dental-chart'

/**
 * Phase 11 — one-click navigation target: the patient's odontogram on its
 * own route (from the appointment detail's "رسم الأسنان" button). Wraps the
 * existing DentalChart/Odontogram component — the Phase 3 component itself
 * is untouched (PROTECTED).
 */
export default function PatientOdontogramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { t } = useLanguage()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/patients/${id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('clinical.odontogram')}</h1>
          <p className="text-sm text-muted-foreground">{t('clinical.patient_file')}</p>
        </div>
      </div>

      <DentalChart patientId={id} />
    </div>
  )
}
