'use client'

/**
 * R1a — NEW 2D odontogram route, beside the existing one.
 *
 * Nothing is deleted or redirected: `/patients/[id]/dental-chart` keeps working
 * exactly as before. This route exists so the replacement can be evaluated
 * side by side before any R3 removal.
 *
 * It reuses the existing `/api/dental-chart` routes, the existing RBAC and the
 * existing shared chart store. No new persistence path, no schema change.
 */

import { use } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/components/providers/language-provider'
import { RaoOdontogram } from '@/components/dental-chart/v2/RaoOdontogram'

export default function PatientDentalChartV2Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
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

      <RaoOdontogram patientId={id} />
    </div>
  )
}
