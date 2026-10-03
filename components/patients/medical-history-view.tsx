'use client'

import Link from 'next/link'
import { FileText } from 'lucide-react'
import { useLanguage } from '@/components/providers/language-provider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// Issue 5 — التاريخ الطبي (medical history) view.
// Renders ONLY what is actually recorded (honest missing markers) — this is
// the clinical data surface, shared by the patient-file tab and the
// /patients/[id]/medical-history page.

export interface MedicalHistoryData {
  bloodGroup?: string | null
  medicalHistory?: {
    hasAllergies?: boolean
    drugAllergies?: string | null
    foodAllergies?: string | null
    materialAllergies?: string | null
    hasDiabetes?: boolean
    diabetesType?: string | null
    hasHypertension?: boolean
    hasHeartDisease?: boolean
    heartCondition?: string | null
    hasBleedingDisorder?: boolean
    hasAsthma?: boolean
    hasThyroid?: boolean
    thyroidType?: string | null
    hasHepatitis?: boolean
    hepatitisType?: string | null
    hasHiv?: boolean
    hasEpilepsy?: boolean
    isPregnant?: boolean
    pregnancyWeeks?: number | null
    otherConditions?: string | null
    currentMedications?: string | null
    previousDentalWork?: string | null
    lastDentalVisit?: string | Date | null
    dentalAnxietyLevel?: number | null
    familyDentalHistory?: string | null
    smokingStatus?: string | null
    alcoholConsumption?: string | null
    tobaccoChewing?: boolean
    additionalNotes?: string | null
  } | null
}

const NOT_RECORDED = 'غير مسجل'

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b last:border-0">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm text-left">{value || NOT_RECORDED}</span>
    </div>
  )
}

export function MedicalHistoryView({ patient, compact = false }: { patient: MedicalHistoryData; compact?: boolean }) {
  const { t } = useLanguage()
  const h = patient.medicalHistory ?? null
  const hasAny = !!h

  const chronic: string[] = []
  if (h?.hasDiabetes) chronic.push(`السكري${h.diabetesType ? ` (${h.diabetesType})` : ''}`)
  if (h?.hasHypertension) chronic.push('ارتفاع ضغط الدم')
  if (h?.hasHeartDisease) chronic.push(`أمراض القلب${h.heartCondition ? ` (${h.heartCondition})` : ''}`)
  if (h?.hasBleedingDisorder) chronic.push('اضطرابات النزيف')
  if (h?.hasAsthma) chronic.push('الربو')
  if (h?.hasThyroid) chronic.push(`أمراض الغدة الدرقية${h.thyroidType ? ` (${h.thyroidType})` : ''}`)
  if (h?.hasHepatitis) chronic.push(`الالتهاب الكبدي${h.hepatitisType ? ` (${h.hepatitisType})` : ''}`)
  if (h?.hasHiv) chronic.push('HIV')
  if (h?.hasEpilepsy) chronic.push('الصرع')
  if (h?.isPregnant) chronic.push(`حمل${h.pregnancyWeeks ? ` (الأسبوع ${h.pregnancyWeeks})` : ''}`)

  const allergyBits: string[] = []
  if (h?.hasAllergies) {
    if (h.drugAllergies) allergyBits.push(`حساسية أدوية: ${h.drugAllergies}`)
    if (h.foodAllergies) allergyBits.push(`حساسية أطعمة: ${h.foodAllergies}`)
    if (h.materialAllergies) allergyBits.push(`حساسية مواد: ${h.materialAllergies}`)
  }

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'} data-testid="medical-history-view">
      {!hasAny && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {t('لا يوجد تاريخ طبي مسجل لهذا المريض بعد — يمكن إضافته من تعديل ملف المريض.')}
          </CardContent>
        </Card>
      )}

      {hasAny && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('الحساسيات')}</CardTitle>
            </CardHeader>
            <CardContent>
              {allergyBits.length ? (
                <div className="space-y-1">
                  {allergyBits.map((a) => (
                    <div key={a} className="flex items-center gap-2">
                      <Badge variant="destructive">تنبيه</Badge>
                      <span className="text-sm">{a}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {h?.hasAllergies === false ? t('لا توجد حساسيات مسجلة') : NOT_RECORDED}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('الحالات المزمنة')}</CardTitle>
            </CardHeader>
            <CardContent>
              {chronic.length ? (
                <div className="flex flex-wrap gap-2">
                  {chronic.map((c) => (
                    <Badge key={c} variant="secondary">{c}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{NOT_RECORDED}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('الأدوية الحالية والعادات')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Row label={t('الأدوية الحالية')} value={h?.currentMedications} />
              <Row label={t('التدخين')} value={h?.smokingStatus === 'NEVER' ? 'غير مدخن' : h?.smokingStatus === 'FORMER' ? 'إقلاع عن التدخين' : h?.smokingStatus === 'CURRENT' ? 'مدخن حاليًا' : h?.smokingStatus == null ? null : h.smokingStatus} />
              <Row label={t('الخمرة')} value={h?.alcoholConsumption === 'NEVER' ? 'لا يشرب' : h?.alcoholConsumption == null ? null : h.alcoholConsumption} />
              <Row label={t('تعظيم التبغ')} value={h?.tobaccoChewing ? 'نعم' : h?.tobaccoChewing === false ? 'لا' : null} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('التاريخ السني')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Row label={t('أعمال سنية سابقة')} value={h?.previousDentalWork} />
              <Row label={t('آخر زيارة سنية')} value={h?.lastDentalVisit ? new Date(h.lastDentalVisit).toLocaleDateString('ar-EG') : null} />
              <Row label={t('تاريخ أسني عائلي')} value={h?.familyDentalHistory} />
              <Row label={t('فوبيا الأسنان (0–10)')} value={h?.dentalAnxietyLevel != null ? String(h.dentalAnxietyLevel) : null} />
              <Row label={t('فصيلة الدم')} value={patient.bloodGroup ?? null} />
              <Row label={t('ملاحظات إضافية')} value={h?.additionalNotes} />
            </CardContent>
          </Card>
        </>
      )}

    </div>
  )
}

export function MedicalHistoryPageLink({ patientId }: { patientId: string }) {
  const { t } = useLanguage()
  return (
    <Link
      href={`/patients/${patientId}/medical-history`}
      className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
    >
      <FileText className="h-4 w-4" />
      {t('فتح التاريخ الطبي كاملًا')}
    </Link>
  )
}
