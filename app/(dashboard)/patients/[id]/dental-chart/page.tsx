'use client'

/**
 * Interactive Dental Chart — patient route (2D/3D workspace).
 *
 * The Phase-3 odontogram route stays untouched; this page hosts the NEW
 * workspace (protected Odontogram + real 3D + clinical context panel),
 * consuming the same server data through the aggregate summary API.
 */

import { use } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/components/providers/language-provider'
import { DentalChartWorkspace } from '@/components/dental-chart/interactive/DentalChartWorkspace'

export default function PatientDentalChartPage({ params }: { params: Promise<{ id: string }> }) {
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
          <h1 className="text-2xl font-bold tracking-tight">{t('dental_chart.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('clinical.patient_file')}</p>
        </div>
      </div>

      <DentalChartWorkspace patientId={id} />
    </div>
  )
}
