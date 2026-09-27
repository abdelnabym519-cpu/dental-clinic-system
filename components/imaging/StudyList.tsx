'use client'

import { Badge } from '@/components/ui/badge'
import { useLanguage } from '@/components/providers/language-provider'
import { derivedStudyStatus, type ImagingStudySummary } from '@/components/imaging/types'

// Phase 20 (D7) — all imaging studies for a patient, newest first.
// Clicking a row opens the study detail (image + findings + review).

interface StudyListProps {
  studies: ImagingStudySummary[]
  selectedId?: string | null
  onSelect?: (id: string) => void
}

const STATUS_STYLES: Record<string, string> = {
  UPLOADED: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300',
  PROCESSING: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  ANALYZED: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  REVIEWED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

export function StudyList({ studies, selectedId = null, onSelect }: StudyListProps) {
  const { t } = useLanguage()

  // Unknown enum values (a future modality) render raw, never as a bare key.
  const modalityLabel = (m: string) => {
    const key = `imaging.modality.${m}`
    const out = t(key)
    return out === key ? m : out
  }
  const statusLabel = (s: string) => {
    const key = `imaging.status.${s}`
    const out = t(key)
    return out === key ? s : out
  }

  if (studies.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {t('No imaging studies yet')}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {studies.map((study) => {
        const status = derivedStudyStatus(study.status, study.latestJob)
        const selected = study.id === selectedId
        return (
          <button
            key={study.id}
            type="button"
            onClick={() => onSelect?.(study.id)}
            className={`flex w-full items-center gap-3 rounded-lg border p-2 text-right transition-colors ${
              selected ? 'border-primary bg-accent' : 'border-border hover:bg-accent/50'
            }`}
          >
            {study.originalUrl ? (
              <img
                src={study.originalUrl}
                alt=""
                className="h-12 w-12 shrink-0 rounded object-cover"
                loading="lazy"
              />
            ) : (
              <div className="h-12 w-12 shrink-0 rounded bg-muted" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{modalityLabel(study.modality)}</span>
                <Badge variant="outline" className={`text-xs ${STATUS_STYLES[status] ?? ''}`}>
                  {statusLabel(status)}
                </Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {formatDate(study.createdAt)}
                {study.latestJob && study.latestJob.findingsCount > 0 && (
                  <> · {t('imaging.findings_count', { count: study.latestJob.findingsCount })}</>
                )}
                {study.latestJob?.reviewedByName && (
                  <> · {t('imaging.review.reviewed_by')}: {study.latestJob.reviewedByName}</>
                )}
              </p>
            </div>
          </button>
        )
      })}
    </div>
  )
}
