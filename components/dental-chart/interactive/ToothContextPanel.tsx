'use client'

/**
 * DenToRa — Interactive Dental Chart: clinical context panel (Stage H/I/J).
 *
 * Appears when a tooth is selected. Purely presentational: mutations are
 * delegated to callbacks owned by the workspace (single refetch point —
 * reload semantics always reconstruct from the DB).
 *
 * Sections: identity + status / findings / procedures (Phase-11 treatment
 * plan items) / related imaging with AI findings (Phase 19-20, read-only).
 * Mutation actions are hidden for read-only roles (RBAC mirrored client-
 * side; enforced server-side in the APIs).
 */

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { X, Plus, Stethoscope, Image as ImageIcon, ClipboardList } from 'lucide-react'
import { useLanguage } from '@/components/providers/language-provider'
import type { DentalChartEntryRecord } from '@/components/dental-chart/types/odontogram'
import { toothNameAr, toothNameEn } from '@/lib/dental-chart/fdi'
import {
  TOOTH_COLORS,
  type ToothTreatmentStatus,
} from '@/lib/dental-chart/clinical-status'
import {
  CHARTABLE_CONDITIONS,
  SEVERITY_LABELS,
  SURFACE_LABELS,
  conditionLabel,
} from '@/lib/dental-chart/labels'

export interface PanelProcedure {
  id: string
  procedureName: string
  status: string
  estimatedCost: string
  planId: string
}

export interface PanelImagingFinding {
  toothNumber: number
  studyId: string
  studyDate: string | null
  modality: string
  label: string
  confidence: number | null
}

export interface CatalogProcedure {
  id: string
  name: string
  basePrice: string
}

export interface ToothContextPanelProps {
  toothNumber: number
  patientId: string
  status: ToothTreatmentStatus
  entries: DentalChartEntryRecord[]
  procedures: PanelProcedure[]
  imaging: PanelImagingFinding[]
  activePlan: { id: string; status: string } | null
  catalog: CatalogProcedure[]
  canModify: boolean
  onAddFinding: (payload: {
    condition: string
    severity: string
    surfaces: Record<string, boolean>
    notes?: string
  }) => Promise<void>
  onAddProcedure: (procedureId: string) => Promise<void>
  onClose: () => void
}

const SURFACES = ['mesial', 'distal', 'occlusal', 'buccal', 'lingual'] as const
const ITEM_STATUS_AR: Record<string, string> = {
  PENDING: 'مخطط',
  SCHEDULED: 'مجدول',
  IN_PROGRESS: 'قيد التنفيذ',
  COMPLETED: 'مكتمل',
  CANCELLED: 'ملغي',
}

export function ToothContextPanel({
  toothNumber,
  patientId,
  status,
  entries,
  procedures,
  imaging,
  activePlan,
  catalog,
  canModify,
  onAddFinding,
  onAddProcedure,
  onClose,
}: ToothContextPanelProps) {
  const { t, locale } = useLanguage()
  const [addingFinding, setAddingFinding] = useState(false)
  const [addingProcedure, setAddingProcedure] = useState(false)
  const [condition, setCondition] = useState<string>('CARIES')
  const [severity, setSeverity] = useState<string>('MODERATE')
  const [surfaces, setSurfaces] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState('')
  const [procedureId, setProcedureId] = useState('')
  const [busy, setBusy] = useState(false)

  const statusLabel = t(`dental_chart.status.${status}`)

  const submitFinding = async () => {
    setBusy(true)
    try {
      await onAddFinding({ condition, severity, surfaces, notes: notes || undefined })
      setAddingFinding(false)
      setSurfaces({})
      setNotes('')
    } finally {
      setBusy(false)
    }
  }

  const submitProcedure = async () => {
    if (!procedureId) return
    setBusy(true)
    try {
      await onAddProcedure(procedureId)
      setAddingProcedure(false)
      setProcedureId('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside
      dir={locale.startsWith('ar') ? 'rtl' : 'ltr'}
      className="rounded-xl border bg-card"
      data-testid="tooth-context-panel"
      aria-label={t('dental_chart.context_panel')}
    >
      {/* header */}
      <div className="flex items-start justify-between gap-2 border-b p-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold">
              {t('dental_chart.tooth')} {toothNumber}
            </h3>
            <Badge
              style={{ backgroundColor: TOOTH_COLORS[status], borderColor: TOOTH_COLORS[status] }}
              className="text-white"
            >
              {statusLabel}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {locale.startsWith('ar') ? toothNameAr(toothNumber) : toothNameEn(toothNumber)}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('dental_chart.close')}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4 p-4">
        {/* findings */}
        <section aria-label={t('dental_chart.finding')}>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold">
              <Stethoscope className="h-4 w-4" /> {t('dental_chart.findings')} ({entries.length})
            </h4>
            {canModify && !addingFinding && (
              <Button size="sm" variant="outline" onClick={() => setAddingFinding(true)}>
                <Plus className="h-3.5 w-3.5" /> {t('dental_chart.add_finding')}
              </Button>
            )}
          </div>
          {entries.length === 0 && !addingFinding && (
            <p className="text-sm text-muted-foreground">{t('dental_chart.no_findings')}</p>
          )}
          <ul className="space-y-1.5">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm">
                <span>{conditionLabel(e.condition, locale)}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {SEVERITY_LABELS[e.severity] ? (locale.startsWith('ar') ? SEVERITY_LABELS[e.severity].ar : SEVERITY_LABELS[e.severity].en) : e.severity}
                  {SURFACES.filter((s) => e[s as keyof DentalChartEntryRecord] === true).length > 0 &&
                    ' · ' +
                      SURFACES.filter((s) => e[s as keyof DentalChartEntryRecord] === true)
                        .map((s) => (locale.startsWith('ar') ? SURFACE_LABELS[s].ar : SURFACE_LABELS[s].en))
                        .join('، ')}
                  {e.resolvedDate ? ` · ${t('dental_chart.resolved')}` : ''}
                </span>
              </li>
            ))}
          </ul>
          {addingFinding && (
            <div className="mt-2 space-y-2 rounded-md border p-3" data-testid="add-finding-form">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="dc-condition">{t('dental_chart.finding')}</Label>
                  <select
                    id="dc-condition"
                    className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
                    value={condition}
                    onChange={(e) => setCondition(e.target.value)}
                  >
                    {CHARTABLE_CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {conditionLabel(c, locale)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="dc-severity">{t('dental_chart.severity')}</Label>
                  <select
                    id="dc-severity"
                    className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                  >
                    {Object.entries(SEVERITY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {locale.startsWith('ar') ? v.ar : v.en}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                {SURFACES.map((s) => (
                  <label key={s} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(surfaces[s])}
                      onChange={(e) => setSurfaces((prev) => ({ ...prev, [s]: e.target.checked }))}
                    />
                    {locale.startsWith('ar') ? SURFACE_LABELS[s].ar : SURFACE_LABELS[s].en}
                  </label>
                ))}
              </div>
              <Input
                placeholder={t('dental_chart.notes')}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={submitFinding} disabled={busy}>
                  {t('dental_chart.save')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAddingFinding(false)}>
                  {t('dental_chart.cancel')}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* procedures (Phase 11) */}
        <section aria-label={t('dental_chart.procedure')}>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold">
              <ClipboardList className="h-4 w-4" /> {t('dental_chart.procedures')} ({procedures.length})
            </h4>
            {canModify && !addingProcedure && (
              <Button size="sm" variant="outline" onClick={() => setAddingProcedure(true)}>
                <Plus className="h-3.5 w-3.5" /> {t('dental_chart.add_procedure')}
              </Button>
            )}
          </div>
          {procedures.length === 0 && !addingProcedure && (
            <p className="text-sm text-muted-foreground">{t('dental_chart.no_procedures')}</p>
          )}
          <ul className="space-y-1.5">
            {procedures.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm">
                <span>{p.procedureName}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  ✓ {ITEM_STATUS_AR[p.status] ?? p.status}
                </span>
              </li>
            ))}
          </ul>
          {addingProcedure && (
            <div className="mt-2 space-y-2 rounded-md border p-3" data-testid="add-procedure-form">
              {activePlan ? (
                <>
                  <Label htmlFor="dc-procedure">{t('dental_chart.select_procedure')}</Label>
                  <select
                    id="dc-procedure"
                    className="w-full rounded-md border bg-background p-2 text-sm"
                    value={procedureId}
                    onChange={(e) => setProcedureId(e.target.value)}
                  >
                    <option value="">—</option>
                    {catalog.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={submitProcedure} disabled={busy || !procedureId}>
                      {t('dental_chart.save')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAddingProcedure(false)}>
                      {t('dental_chart.cancel')}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t('dental_chart.no_active_plan')}</p>
              )}
            </div>
          )}
        </section>

        {/* related imaging + AI findings (Phase 19-20, read-only) */}
        <section aria-label={t('dental_chart.related_xrays')}>
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <ImageIcon className="h-4 w-4" /> {t('dental_chart.related_xrays')} ({imaging.length})
          </h4>
          {imaging.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('dental_chart.no_imaging')}</p>
          ) : (
            <ul className="space-y-1.5">
              {imaging.map((im, i) => (
                <li key={`${im.studyId}-${i}`} className="rounded-md border px-2.5 py-1.5 text-sm">
                  <Link
                    href={`/patients/${patientId}/imaging?study=${im.studyId}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {im.modality} — {im.label}
                  </Link>
                  <span className="ms-2 text-xs text-muted-foreground">
                    {im.confidence != null
                      ? t('dental_chart.confidence', { value: Math.round(im.confidence * 100) })
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-muted-foreground">{t('dental_chart.ai_disclaimer')}</p>
        </section>
      </div>
    </aside>
  )
}
